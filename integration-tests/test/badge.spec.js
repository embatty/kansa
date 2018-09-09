const assert = require('assert')
const fs = require('fs')
const request = require('supertest')
const YAML = require('yaml').default

const config = YAML.parse(fs.readFileSync('../config/kansa.yaml', 'utf8'))
if (!config.modules.badge) return

const ca = fs.readFileSync('../proxy/ssl/localhost.cert', 'utf8')
const host = 'localhost:4430'

let pngType = 'image/png'

if (process.env.CI) {
  // Tarra requires fonts that are normally mounted from the file system, and
  // are not included in the build on the CI servers. So we hack around the
  // problem for now by expecting the responses to fail. -- Eemeli, 2018-09-09
  pngType = 'text/html; charset=UTF-8'
}

describe('Badges', () => {
  const key = 'key'
  let id = null

  describe('member access', () => {
    const member = request.agent(`https://${host}`, { ca })

    before(() => {
      const email = 'member@example.com'
      return member
        .get('/api/login')
        .query({ email, key })
        .expect('set-cookie', /w75/)
        .expect(200, { status: 'success', email })
        .then(() => member.get('/api/user'))
        .then(res => {
          id = res.body.people[0].id
          assert.equal(typeof id, 'number')
        })
    })

    it('get own badge', () =>
      member
        .get(`/api/badge/${id}`)
        .expect(200)
        .expect('Content-Type', pngType))

    it("fail to get other's badge", () =>
      member.get(`/api/badge/${id - 1}`).expect(401))

    it('fail to log own badge as printed', () =>
      member
        .post(`/api/badge/${id}/print`)
        .send()
        .expect(401))
  })

  describe('anonymous access', () => {
    const anonymous = request.agent(`https://${host}`, { ca })

    it('get blank badge', () =>
      anonymous
        .get('/api/badge/blank')
        .expect(200)
        .expect('Content-Type', pngType))

    it("fail to get member's badge", () =>
      anonymous.get(`/api/badge/${id}`).expect(401))
  })

  describe('admin access', () => {
    const admin = request.agent(`https://${host}`, { ca })
    before(() => {
      const email = 'admin@example.com'
      return admin
        .get('/api/login')
        .query({ email, key })
        .expect('set-cookie', /w75/)
        .expect(200, { status: 'success', email })
        .then(() => admin.get('/api/user'))
        .then(res => {
          assert.notEqual(res.body.roles.indexOf('member_admin'), -1)
        })
    })

    it("get member's badge", () =>
      admin
        .get(`/api/badge/${id}`)
        .expect(200)
        .expect('Content-Type', pngType))

    it("log the member's badge as printed", () =>
      admin
        .post(`/api/badge/${id}/print`)
        .send()
        .expect(200)
        .expect(res => assert.equal(res.body.status, 'success')))
  })
})
