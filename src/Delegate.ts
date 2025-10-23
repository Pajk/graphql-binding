import { $$asyncIterator } from 'iterall'
import { buildInfo } from './info'
import {
  GraphQLResolveInfo,
  graphql,
  GraphQLSchema,
  buildSchema,
  GraphQLUnionType,
  GraphQLInterfaceType,
  OperationTypeNode,
  print,
} from 'graphql'
import { delegateToSchema } from '@graphql-tools/delegate'
import type { IResolvers } from '@graphql-tools/utils'
import {
  BindingOptions,
  Options,
  QueryOrMutation,
  Operation,
  FragmentReplacement,
} from './types'
import { processImport } from '@graphql-tools/import'
import * as fs from 'fs'
import * as path from 'path'
import { addFragmentToInfo } from './utils/addFragmentToInfo'

export class Delegate {
  schema: GraphQLSchema
  before: () => void
  disableCache: boolean

  private fragmentReplacements: FragmentReplacement[]

  constructor({
    schema,
    fragmentReplacements,
    before,
    disableCache,
  }: BindingOptions) {
    this.fragmentReplacements = fragmentReplacements || []
    this.schema = schema
    this.disableCache = disableCache || false

    this.before = before || (() => undefined)
  }

  public async request<T = any>(
    query: string,
    variables?: { [key: string]: any },
  ): Promise<T> {
    this.before()
    const result = await graphql({
      schema: this.schema,
      source: query,
      variableValues: variables,
    })
    return result as any
  }

  public async delegate(
    operation: QueryOrMutation,
    fieldName: string,
    args: {
      [key: string]: any
    },
    infoOrQuery?: GraphQLResolveInfo | string,
    options?: Options,
  ) {
    this.before()

    return this.delegateToSchema(
      operation,
      fieldName,
      args,
      infoOrQuery,
      options,
    ).result
  }

  public async delegateSubscription(
    fieldName: string,
    args?: { [key: string]: any },
    infoOrQuery?: GraphQLResolveInfo | string,
    options?: Options,
  ): Promise<AsyncIterator<any>> {
    this.before()

    const { result, info } = this.delegateToSchema(
      'subscription',
      fieldName,
      args,
      infoOrQuery,
      options,
    )

    const iterator = await result

    return {
      async next() {
        const { value } = await iterator.next()
        const data = { [info.fieldName]: value[fieldName] }
        return { value: data, done: false }
      },
      return() {
        iterator.return()
        return Promise.resolve({ value: undefined, done: true })
      },
      throw(error) {
        return Promise.reject(error)
      },
      [$$asyncIterator]() {
        return this
      },
    }
  }

  public getAbstractResolvers(
    filterSchema?: GraphQLSchema | string,
  ): IResolvers {
    const typeMap = this.schema.getTypeMap()

    let maybeFilterSchema = filterSchema
    if (filterSchema && typeof filterSchema === 'string') {
      let schemaSDL = filterSchema
      if (filterSchema.endsWith('graphql')) {
        const schemaPath = path.resolve(filterSchema)

        if (!fs.existsSync(schemaPath)) {
          throw new Error(`No schema found for path: ${schemaPath}`)
        }

        const importedDoc = processImport(schemaPath)
        schemaSDL = print(importedDoc)
      }
      maybeFilterSchema = buildSchema(schemaSDL)
    }
    const filterTypeMap =
      maybeFilterSchema instanceof GraphQLSchema
        ? maybeFilterSchema.getTypeMap()
        : typeMap
    const filterType = (typeName) => typeName in filterTypeMap

    const resolvers = {}
    Object.keys(typeMap)
      .filter(filterType)
      .forEach((typeName) => {
        const type = typeMap[typeName]
        if (
          type instanceof GraphQLUnionType ||
          type instanceof GraphQLInterfaceType
        ) {
          resolvers[typeName] = {
            __resolveType: type.resolveType,
          }
        }
      })

    return resolvers
  }

  private delegateToSchema(
    operation: Operation,
    fieldName: string,
    args?: { [key: string]: any },
    infoOrQuery?: GraphQLResolveInfo | string,
    options?: Options,
  ): { info: any; result: Promise<any> } {
    let info = buildInfo(fieldName, operation, this.schema, infoOrQuery)
    info = this.applyFragmentReplacements(fieldName, info)

    const transforms = options && options.transforms ? options.transforms : []
    const operationNode =
      operation === 'mutation'
        ? OperationTypeNode.MUTATION
        : operation === 'subscription'
          ? OperationTypeNode.SUBSCRIPTION
          : OperationTypeNode.QUERY
    const result = delegateToSchema({
      schema: this.schema,
      operation: operationNode,
      fieldName,
      args: args || {},
      context: options && options.context ? options.context : {},
      info,
      transforms,
    })

    return { info, result }
  }

  private applyFragmentReplacements(
    fieldName: string,
    info: GraphQLResolveInfo,
  ): GraphQLResolveInfo {
    return this.fragmentReplacements
      .filter((replacement) => replacement.field === fieldName)
      .reduce<GraphQLResolveInfo>((acc, replacement) => {
        return addFragmentToInfo(acc, replacement.fragment)
      }, info)
  }
}
