const prices = require('../static/prices.json');
const purchaseData = require('../static/purchase-data.json');
const { InputError } = require('./errors');
const Payment = require('./types/payment');
const Person = require('./types/person');
const { getKeyChecked } = require('./key');
const sendEmail = require('./kyyhky-send-email');
const { addPerson } = require('./people');
const { upgradePerson } = require('./upgrade');


class Purchase {
  constructor(pgp, db) {
    this.pgp = pgp;
    this.db = db;
    this.getPrices = this.getPrices.bind(this);
    this.getPurchaseData = this.getPurchaseData.bind(this);
    this.getPurchases = this.getPurchases.bind(this);
    this.makeMembershipPurchase = this.makeMembershipPurchase.bind(this);
    this.makeOtherPurchase = this.makeOtherPurchase.bind(this);
  }

  getPrices(req, res, next) {
    if (!prices) next(new Error('Missing membership prices!?'));
    res.status(200).json(prices);
  }

  getPurchaseData(req, res, next) {
    if (!purchaseData) next(new Error('Missing purchase data!?'));
    res.status(200).json(purchaseData);
  }

  getPurchases(req, res, next) {
    const email = req.session.user.member_admin && req.query.email || req.session.user.email;
    this.db.any(`
      SELECT *
        FROM Payments
       WHERE payment_email=$1 OR
             person_id IN (
               SELECT id FROM People WHERE email=$1
             )`, email)
      .then(data => res.status(200).json(data));
  }

  checkUpgrades(reqUpgrades) {
    if (reqUpgrades.length === 0) return Promise.resolve([]);
    return this.db.any(`
      SELECT id, email, membership, preferred_name(p) as name, paper_pubs
        FROM People p
       WHERE id IN ($1:csv)`, [reqUpgrades.map(u => u.id)]
    ).then(prevData => {
      if (prevData.length !== reqUpgrades.length) throw new InputError(
        `Error in upgrades: found ${prevData.length} of ${reqUpgrades.length} memberships`
      );
      return reqUpgrades.map(upgrade => {
        const prev = prevData.find(m => m.id === upgrade.id);
        if (!prev || !prev.membership) throw new InputError(`Previous membership not found for ${JSON.stringify(upgrade)}`);
        if (!upgrade.membership || upgrade.membership === prev.membership) {
          delete upgrade.membership;
        } else {
          const ti0 = Person.membershipTypes.indexOf(prev.membership);
          const ti1 = Person.membershipTypes.indexOf(upgrade.membership);
          if (ti1 <= ti0) throw new InputError(
            `Can't "upgrade" from ${JSON.stringify(prev.membership)} to ${JSON.stringify(upgrade.membership)}`
          );
        }

        if (upgrade.paper_pubs) {
          if (prev.paper_pubs) throw new InputError(`${JSON.stringify(upgrade)} already has paper pubs!`);
        } else if (!upgrade.membership) {
          throw new InputError('Change in at least one of membership and/or paper_pubs is required for upgrade');
        }

        const prevPriceData = prices.memberships[prev.membership]
        const membershipAmount = upgrade.membership
          ? prices.memberships[upgrade.membership].amount - (prevPriceData && prevPriceData.amount || 0)
          : 0;
        const paperPubsAmount = upgrade.paper_pubs ? prices.PaperPubs.amount : 0;

        return Object.assign({}, upgrade, {
          amount: membershipAmount + paperPubsAmount,
          email: prev.email,
          name: prev.name,
          paper_pubs: Person.cleanPaperPubs(upgrade.paper_pubs),
          prev_membership: prev.membership
        });
      });
    });
  }

  makeMembershipPurchase(req, res, next) {
    const amount = Number(req.body.amount);
    const email = req.body.email;
    const token = req.body.token;
    if (!amount || !email || !token) return next(
      new InputError('Required parameters: amount, email, token')
    );
    const newMembers = (req.body.new_members || []).map(src => new Person(src));
    const reqUpgrades = req.body.upgrades || [];
    if (newMembers.length === 0 && reqUpgrades.length === 0) return next(
      new InputError('Non-empty new_members or upgrades is required')
    );
    const sentEmails = {};
    let charge_id, upgrades;
    this.checkUpgrades(reqUpgrades).then(_upgrades => {
      upgrades = _upgrades;
      const newMemberPaymentItems = newMembers.map(p => ({
        amount: p.priceAsNewMember,
        currency: 'eur',
        category: 'New membership',
        type: p.data.membership,
        data: p.data
      }));
      const upgradePaymentItems = upgrades.map(u => ({
        amount: u.amount,
        currency: 'eur',
        person_id: u.id,
        category: 'Upgrade membership',
        type: 'upgrade',
        data: { membership: u.membership, paper_pubs: u.paper_pubs || undefined },
      }));
      const items = newMemberPaymentItems.concat(upgradePaymentItems);
      const calcAmount = items.reduce((sum, item) => sum + item.amount, 0);
      if (amount !== calcAmount) throw new InputError(`Amount mismatch: in request ${amount}, calculated ${calcAmount}`);
      return new Payment(this.pgp, this.db, { id: token, email }, items)
        .process()
    }).then(items => {
      charge_id = items[0].stripe_charge_id;
      return Promise.all(upgrades.map(u => (
        upgradePerson(req, this.db, u)
          .then(({ member_number }) => {
            u.member_number = member_number;
            return getKeyChecked(req, u.email);
          })
          .then(({ key }) => sendEmail(
            ((!u.membership || u.membership === u.prev_membership) && u.paper_pubs)
              ? 'kansa-add-paper-pubs' : 'kansa-upgrade-person',
            Object.assign({ charge_id, key }, u)
          ))
          .then(() => sentEmails[u.email] = true)
      )));
    }).then(() => Promise.all(
      newMembers.map(m => (
        addPerson(req, this.db, m)
          .then(({ id, member_number }) => {
            m.data.id = id;
            m.data.member_number = member_number;
            return getKeyChecked(req, m.data.email);
          })
          .then(({ key }) => sendEmail(
            'kansa-new-member',
            Object.assign({ charge_id, key, name: m.preferredName }, m.data)
          ))
          .then(() => sentEmails[m.data.email] = true)
      ))
    )).then(() => {
      res.status(200).json({ status: 'success', emails: Object.keys(sentEmails) });
    }).catch(next);
  }

  makeOtherPurchase(req, res, next) {
    new Payment(this.pgp, this.db, req.body.token, req.body.items)
      .process()
      .then(items => res.status(200).json({
        status: 'success',
        email: items[0].payment_email,
        stripe_charge_id: items[0].stripe_charge_id
      }))
      .catch(next);
  }
}

module.exports = Purchase;
