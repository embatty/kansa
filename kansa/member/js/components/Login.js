import React from 'react';  
import { Link } from 'react-router'

// ...
export default React.createClass({
  render() {
    return (
      <div>
        <h2>{this.props.params.email}</h2>
      </div>
    )
  }
})