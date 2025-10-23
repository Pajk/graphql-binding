import {
  GraphQLSchema,
  GraphQLResolveInfo,
  FieldNode,
  SelectionSetNode,
  GraphQLOutputType,
  GraphQLObjectType,
  GraphQLInterfaceType,
  GraphQLScalarType,
  GraphQLNamedType,
  Kind,
  getNamedType,
  DocumentNode,
  print,
  parse,
  validate,
  isObjectType,
  isInterfaceType,
  isScalarType,
  InlineFragmentNode,
  SelectionNode,
  NameNode,
  OperationTypeNode,
} from 'graphql'
import { addPath } from 'graphql/jsutils/Path'
import type { Path } from 'graphql/jsutils/Path'

import { Operation } from './types'
import { isScalar, getTypeForRootFieldName } from './utils'
import { addFragmentToInfo } from './utils/addFragmentToInfo'

const createNameNode = (value: string): NameNode => ({
  kind: Kind.NAME,
  value,
})

const createSelectionSet = (
  selections: ReadonlyArray<SelectionNode>,
): SelectionSetNode => ({
  kind: Kind.SELECTION_SET,
  selections,
})

const createFieldNode = (
  name: string,
  selectionSet?: SelectionSetNode,
): FieldNode => ({
  kind: Kind.FIELD,
  name: createNameNode(name),
  selectionSet,
})

const getRootOperationType = (schema: GraphQLSchema, operation: Operation) =>
  (
    ({
      query: () => schema.getQueryType(),
      mutation: () => schema.getMutationType(),
      subscription: () => schema.getSubscriptionType(),
    })[operation] || (() => undefined)
  )()

const toOperationTypeNode = (operation: Operation): OperationTypeNode => {
  switch (operation) {
    case 'mutation':
      return OperationTypeNode.MUTATION
    case 'subscription':
      return OperationTypeNode.SUBSCRIPTION
    case 'query':
    default:
      return OperationTypeNode.QUERY
  }
}

export function buildInfo(
  rootFieldName: string,
  operation: Operation,
  schema: GraphQLSchema,
  info?: GraphQLResolveInfo | string | DocumentNode,
): GraphQLResolveInfo {
  if (!info) {
    info = buildInfoForAllScalars(rootFieldName, schema, operation)
  } else if ((info as any).kind && (info as any).kind === 'Document') {
    info = print(info as DocumentNode)
  }
  if (typeof info === 'string') {
    info = buildInfoFromFragment(rootFieldName, schema, operation, info)
  }
  return info as any
}

export function buildInfoForAllScalars(
  rootFieldName: string,
  schema: GraphQLSchema,
  operation: Operation,
): GraphQLResolveInfo {
  const fieldNodes: FieldNode[] = []
  const type = getTypeForRootFieldName(rootFieldName, operation, schema)
  const namedType = getNamedType(type)

  let selections: ReadonlyArray<FieldNode> | undefined
  if (isInterfaceType(namedType) || isObjectType(namedType)) {
    const fields = (
      namedType as GraphQLObjectType | GraphQLInterfaceType
    ).getFields()
    const scalarFields = Object.keys(fields).filter((f) =>
      isScalar(fields[f].type),
    )
    if (scalarFields.length > 0) {
      selections = scalarFields.map((fieldName) =>
        createFieldNode(fields[fieldName].name),
      )
    }
  }

  const fieldNode: FieldNode = createFieldNode(
    rootFieldName,
    selections ? createSelectionSet(selections) : undefined,
  )

  fieldNodes.push(fieldNode)

  const parentType = getRootOperationType(schema, operation)

  return {
    fieldNodes,
    fragments: {},
    schema,
    fieldName: rootFieldName,
    returnType: type,
    parentType: parentType!,
    path: undefined as unknown as Path,
    rootValue: undefined,
    operation: {
      kind: Kind.OPERATION_DEFINITION,
      operation: toOperationTypeNode(operation),
      selectionSet: createSelectionSet([] as SelectionNode[]),
      variableDefinitions: [],
    },
    variableValues: {},
  }
}

export function buildInfoFromFragment(
  rootFieldName: string,
  schema: GraphQLSchema,
  operation: Operation,
  query: string,
): GraphQLResolveInfo {
  const type = getTypeForRootFieldName(rootFieldName, operation, schema)
  const namedType = getNamedType(type)!
  const fieldNode: FieldNode = createFieldNode(
    rootFieldName,
    extractQuerySelectionSet(query, namedType.name!, schema),
  )

  const parentType = getRootOperationType(schema, operation)

  return {
    fieldNodes: [fieldNode],
    fragments: {},
    schema,
    fieldName: rootFieldName,
    returnType: type,
    parentType: parentType!,
    path: undefined as unknown as Path,
    rootValue: undefined,
    operation: {
      kind: Kind.OPERATION_DEFINITION,
      operation: toOperationTypeNode(operation),
      selectionSet: createSelectionSet([] as SelectionNode[]),
      variableDefinitions: [],
    },
    variableValues: {},
  }
}

function extractQuerySelectionSet(
  query: string,
  typeName: string,
  schema: GraphQLSchema,
): SelectionSetNode {
  if (!query.startsWith('fragment')) {
    query = `fragment tmp on ${typeName} ${query}`
  }
  const document = parse(query)
  const errors = validate(schema, document).filter(
    (e) => e.message.match(/Fragment ".*" is never used./) === null,
  )
  if (errors.length > 0) {
    throw errors
  }

  const queryNode = document.definitions[0]
  if (!queryNode || queryNode.kind !== 'FragmentDefinition') {
    throw new Error(`Invalid query: ${query}`)
  }

  return queryNode.selectionSet
}

/**
 * Generates a sub info based on the provided path. If provided path is not included in the selection set, the function returns null.
 * @param info GraphQLResolveInfo
 * @param path string
 * @param fragment string | undefined
 */
export function makeSubInfo(
  info: GraphQLResolveInfo,
  path: string,
  fragment?: string,
): GraphQLResolveInfo | null {
  const returnType = getDeepType(info.returnType)
  if (isScalarType(returnType)) {
    throw new Error(`Can't make subInfo for type ${info.returnType.toString()}`)
  }

  const fieldsToTraverse = path.split('.')
  if (fieldsToTraverse.length === 0) {
    return null
  }

  const [rootFieldNode] = info.fieldNodes
  if (!rootFieldNode) {
    return null
  }

  let currentSelectionSet = rootFieldNode.selectionSet
  if (!currentSelectionSet) {
    return null
  }

  let currentType: GraphQLOutputType = info.returnType
  let parentType: GraphQLObjectType | undefined
  let currentFieldName: string | undefined

  let currentPath: Path =
    info.path ??
    ({
      prev: undefined,
      key: rootFieldNode.name.value,
      typename: undefined,
    } as Path)

  for (let index = 0; index < fieldsToTraverse.length; index += 1) {
    const segment = fieldsToTraverse[index]
    currentFieldName = segment

    const namedCurrentType = getNamedType(currentType) as GraphQLNamedType
    if (!isObjectType(namedCurrentType)) {
      throw new Error(
        `Can't get subInfo for type ${currentType.toString()} as needs to be a GraphQLObjectType`,
      )
    }

    const fields = (namedCurrentType as GraphQLObjectType).getFields()
    const fieldConfig = fields[currentFieldName]
    if (!fieldConfig) {
      throw new Error(
        `Type ${namedCurrentType.toString()} has no field called ${currentFieldName}`,
      )
    }

    const fieldType = fieldConfig.type
    parentType = namedCurrentType as GraphQLObjectType
    currentType = fieldType

    const selections = currentSelectionSet?.selections ?? []
    const directSelection = selections.find(
      (selection): selection is FieldNode =>
        selection.kind === Kind.FIELD &&
        selection.name.value === currentFieldName,
    )

    let nextSelectionSet = directSelection?.selectionSet
    if (!nextSelectionSet) {
      for (const selection of selections) {
        if (selection.kind === Kind.INLINE_FRAGMENT) {
          nextSelectionSet = (selection as InlineFragmentNode).selectionSet
          break
        }
      }
    }

    if (!directSelection && !nextSelectionSet) {
      return null
    }

    const namedFieldType = getNamedType(fieldType) as GraphQLNamedType
    const typename =
      isObjectType(namedFieldType) || isInterfaceType(namedFieldType)
        ? namedFieldType.name
        : undefined

    currentPath = addPath(currentPath, currentFieldName, typename)
    currentSelectionSet = nextSelectionSet
  }

  if (!currentFieldName) {
    return null
  }

  const fieldNode = createFieldNode(currentFieldName, currentSelectionSet)

  const newInfo: GraphQLResolveInfo = {
    fieldNodes: [fieldNode],
    fragments: {},
    schema: info.schema,
    fieldName: currentFieldName,
    returnType: currentType,
    parentType: parentType!,
    path: currentPath,
    rootValue: undefined,
    operation: {
      kind: Kind.OPERATION_DEFINITION,
      operation: info.operation.operation,
      selectionSet: createSelectionSet([] as SelectionNode[]),
      variableDefinitions: [],
    },
    variableValues: {},
  }

  return fragment ? addFragmentToInfo(newInfo, fragment) : newInfo
}

export function getDeepType(
  type: GraphQLOutputType,
): GraphQLObjectType | GraphQLScalarType {
  if ((type as any).ofType) {
    return getDeepType((type as any).ofType)
  }

  return type as any
}
