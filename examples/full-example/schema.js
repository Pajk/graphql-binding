const { buildSchema } = require('graphql')
const fs = require('fs')
const { addMocksToSchema } = require('@graphql-tools/mock')

const schema = buildSchema(
  fs.readFileSync(__dirname + '/schema.graphql', 'utf-8'),
)

addMocksToSchema({ schema })

module.exports = schema
