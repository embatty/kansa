const webpack = require('webpack');

module.exports = {
  entry: './src/index.jsx',
  output: {
    path: './dist',
    filename: 'bundle.js',
  },
  module: {
    loaders: [
      {
        test: /\.jsx?$/, exclude: /node_modules/,
        loader: 'babel', query: {
          presets: [ 'es2015', 'react' ],
          plugins: [ 'transform-class-properties', 'transform-object-rest-spread' ]
        }
      },
      { test: /\.css$/, loader: 'style!css' }
    ]
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env': {
        NODE_ENV: JSON.stringify(process.env.NODE_ENV || ''),
        KANSA_API_HOST: JSON.stringify(process.env.KANSA_API_HOST || 'localhost:4430/api/kansa'),
        KANSA_TITLE: JSON.stringify(process.env.KANSA_TITLE || 'Kansa')
      }
    })
  ],
  resolve: {
    extensions: [ '', '.js', '.jsx', '.css' ]
  },
  devServer: {
    contentBase: './dist'
  }
}
