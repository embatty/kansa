import { Map } from 'immutable'
import React, { PropTypes } from 'react'
import ImmutablePropTypes from 'react-immutable-proptypes'
import { connect } from 'react-redux'
import { Link } from 'react-router'

const { Col, Row } = require('react-flexbox-grid');
import { Card } from 'material-ui/Card'
import Divider from 'material-ui/Divider'
import Snackbar from 'material-ui/Snackbar'

import { setScene } from '../../app/actions/app'
import { categoryInfo } from '../../hugo-nominations/constants'
import { getFinalists, setVoter } from '../actions'
import * as VotePropTypes from '../proptypes'

import VoteCategory from './VoteCategory'
import VoteIntro from './VoteIntro'
import VoteSignature from './VoteSignature'

class Vote extends React.Component {

  static propTypes = {
    getFinalists: PropTypes.func.isRequired,
    person: ImmutablePropTypes.map,
    setScene: PropTypes.func.isRequired,
    setVoter: PropTypes.func.isRequired,
    signature: PropTypes.string,
    voterId: PropTypes.number
  }

  componentDidMount() {
    const { getFinalists, setScene } = this.props;
    getFinalists();
    setScene({ title: 'Hugo Award Voting', dockSidebar: false });
    this.componentWillReceiveProps(this.props);
  }

  componentWillReceiveProps({ person, setVoter, voterId }) {
    const personId = person && person.get('id') || null;
    if (personId !== voterId) setVoter(personId, null);
  }

  render() {
    const { person, setVoter, signature } = this.props;
    const active = person.get('can_hugo_vote');
    if (!person) return <div>Voter not found!</div>;
    return (
      <div>
        <Row>
          <Col
            xs={12}
            sm={10} smOffset={1}
            md={8} mdOffset={2}
            lg={6} lgOffset={3}
            style={{ paddingTop: 20 }}
          >
            <Card>
              <VoteIntro active={active} />
              <Divider />
              <VoteSignature
                person={person}
                preferredName={this.name}
                signature={signature}
                setSignature={signature => setVoter(person.get('id'), signature)}
              />
            </Card>
          </Col>
        </Row>
        {signature ? (
          <Row>
            <Col
              xs={12}
              md={10} mdOffset={1}
              lg={8} lgOffset={2}
              style={{ marginBottom: -30 }}
            >
              {Object.keys(categoryInfo).map(category => (
                <VoteCategory category={category} key={category} />
              ))}
              <div
                className="bg-text"
                style={{
                  fontSize: 14,
                  marginTop: -14,
                  padding: '0 0 16px 15px',
                  position: 'absolute',
                  width: '48%'
                }}
              >
                <p>
                  Your votes are automatically saved to our server every few
                  seconds. You will receive a confirmation email of your votes
                  thirty minutes after your last change.
                </p>
                <p>
                  Thank you for voting in the 2017 Hugo Awards!
                </p>
                <p>
                  <Link to="/">&laquo; Return to the main member page</Link>
                </p>
              </div>
            </Col>
          </Row>
        ) : null}
      </div>
    );
  }

  get name() {
    const { person } = this.props;
    if (!Map.isMap(person)) return '<>';
    const pna = [person.get('public_first_name'), person.get('public_last_name')];
    const pns = pna.filter(s => s).join(' ');
    return pns || person.get('legal_name');
  }

}

export default connect(
  ({ hugoVotes, user }, { params }) => {
    const id = params && Number(params.id);
    const people = user.get('people');
    return {
      person: id && people && people.find(p => p.get('id') === id),
      signature: hugoVotes.get('signature'),
      voterId: hugoVotes.get('id')
    }
  }, {
    getFinalists,
    setScene,
    setVoter
  }
)(Vote);
