const jwt = require('jsonwebtoken')
const { AuthError, InputError } = require('@kansa/errors')
const sendEmail = require('./kyyhky-send-email')

class Vote {
  constructor(pgp, db) {
    this.db = db
    this.getFinalists = this.getFinalists.bind(this)
    this.getPacket = this.getPacket.bind(this)
    this.packetSeriesExtra = this.packetSeriesExtra.bind(this)
    this.getVotes = this.getVotes.bind(this)
    this.setVotes = this.setVotes.bind(this)

    const svCS = new pgp.helpers.ColumnSet(
      [
        'client_ip',
        'client_ua',
        'person_id',
        'signature',
        'category',
        { name: 'votes', cast: 'integer[]' }
      ],
      { table: 'votes' }
    )
    this._setVoteData = data =>
      db.many(`${pgp.helpers.insert(data, svCS)} RETURNING time`)
  }

  access(req) {
    const id = parseInt(req.params.id)
    if (isNaN(id) || id < 0)
      return Promise.reject(new InputError('Bad id number'))
    if (!req.session || !req.session.user || !req.session.user.email)
      return Promise.reject(new AuthError())
    return this.db
      .oneOrNone(
        `
      SELECT p.email, m.wsfs_member
      FROM kansa.People p
        LEFT JOIN kansa.membership_types m USING (membership)
      WHERE id = $1`,
        id
      )
      .then(data => {
        if (
          !data ||
          (!req.session.user.hugo_admin &&
            req.session.user.email !== data.email)
        )
          throw new AuthError()
        return {
          id,
          voter: !!data.wsfs_member
        }
      })
  }

  getFinalists(req, res, next) {
    this.db
      .any(
        `SELECT category, id, title, subtitle FROM Finalists ORDER BY sortindex, id`
      )
      .then(data =>
        res.status(200).json(
          data.reduce((res, { category, id, title, subtitle }) => {
            const finalist = { id, title, subtitle: subtitle || undefined }
            if (res[category]) res[category].push(finalist)
            else res[category] = [finalist]
            return res
          }, {})
        )
      )
      .catch(next)
  }

  getPacket(req, res, next) {
    const options = { httpOnly: true, path: '/hugo-packet', secure: true }
    this.access(req)
      .then(
        ({ id, voter }) =>
          new Promise((resolve, reject) => {
            if (!voter) return reject(new AuthError('Not a Hugo voter'))
            jwt.sign(
              { scope: 'wsfs' },
              process.env.JWT_SECRET,
              {
                expiresIn: 120 * 60,
                subject: String(id)
              },
              (err, token) => {
                if (err) reject(err)
                else resolve(token)
              }
            )
          })
      )
      .then(token => {
        res.cookie('packet', token, options)
        return this.db.any(`SELECT * FROM Packet ORDER BY category, format`)
      })
      .then(data =>
        res.json(
          data.reduce((set, { category, filename, filesize, format }) => {
            const ss =
              filesize < 800 * 1024
                ? `${(filesize / 10240).toFixed(0)}0kB`
                : `${(filesize / (1024 * 1024)).toFixed(0)}MB`
            const obj = {
              label: `${format.toUpperCase()}, ${ss}`,
              url: `${options.path}/${filename}`
            }
            if (set[category]) set[category][format] = obj
            else set[category] = { [format]: obj }
            return set
          }, {})
        )
      )
      .catch(error => {
        res.clearCookie('packet', options)
        next(error)
      })
  }

  packetSeriesExtra(req, res, next) {
    this.access(req)
      .then(({ id, voter }) => {
        if (!voter) throw new AuthError()
        return this.db.one(
          `
          SELECT email, kansa.preferred_name(p) as name
            FROM kansa.People AS p
           WHERE id = $1`,
          id
        )
      })
      .then(({ email, name }) =>
        sendEmail('hugo-packet-series-extra', { email, name })
      )
      .then(() => res.json({ status: 'success' }))
      .catch(next)
  }

  getVotes(req, res, next) {
    this.access(req)
      .then(({ id }) =>
        this.db.any(
          `
          SELECT DISTINCT ON (category) category, votes, time
            FROM Votes
           WHERE person_id = $1
        ORDER BY category, time DESC`,
          id
        )
      )
      .then(data =>
        res.json(
          data.reduce((set, { category, time, votes }) => {
            set[category] = { time, votes }
            return set
          }, {})
        )
      )
      .catch(next)
  }

  sendVoteEmail(id) {
    this.db
      .task(t =>
        t.batch([
          t.one(
            `
        SELECT k.email, k.key, kansa.preferred_name(p) as name
          FROM kansa.People AS p
          JOIN kansa.Keys AS k USING (email)
         WHERE id = $1`,
            id
          ),
          t.any(
            `
        SELECT category,
               array_agg(
                   CASE id
                       WHEN 0 THEN '[No entry]'
                       WHEN -1 THEN 'No award'
                       ELSE coalesce(title, '[No entry]')
                   END
                   ORDER BY ordinality
               ) AS finalists
          FROM ( SELECT DISTINCT ON (category) category, votes
                   FROM Votes WHERE person_id = $1
               ORDER BY category, time DESC ) AS s
          JOIN unnest(votes) WITH ORDINALITY AS id ON TRUE
     LEFT JOIN Finalists f USING (id, category)
      GROUP BY category
      ORDER BY category`,
            id
          )
        ])
      )
      .then(([person, votes]) =>
        sendEmail(
          'hugo-update-votes',
          Object.assign({ memberId: id, votes }, person),
          30
        )
      )
      .catch(err => console.error(err))
  }

  setVotes(req, res, next) {
    let { lastmod, signature, votes } = req.body
    if (!signature || !votes)
      return next(new InputError('Required parameters: signature, votes'))
    if (typeof votes === 'string')
      try {
        votes = JSON.parse(votes)
      } catch (e) {
        return next(new InputError(e.message))
      }
    let data = null
    this.access(req)
      .then(({ id, voter }) => {
        if (!voter) throw new AuthError()
        data = Object.keys(votes).map(category => ({
          client_ip: req.ip,
          client_ua: req.headers['user-agent'] || null,
          person_id: id,
          signature,
          category,
          votes: votes[category]
        }))
        return this.db.one(`SELECT max(time) from Votes where person_id=$1`, id)
      })
      .then(({ max }) => {
        if (max) {
          const dm = new Date(lastmod)
          if (!lastmod || isNaN(dm) || dm < max)
            throw new InputError('Client has stale data')
        }
        return this._setVoteData(data)
      })
      .then(([{ time }, ...rest]) => {
        res.status(200).json({ status: 'success', time, votes })
        this.sendVoteEmail(data[0].person_id)
      })
      .catch(next)
  }
}

module.exports = Vote
