import {
  GraphQLSchema,
  GraphQLResolveInfo,
  GraphQLOutputType,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLInterfaceType,
  GraphQLUnionType,
  GraphQLList,
  GraphQLEnumType,
  GraphQLNonNull,
  print,
  DocumentNode,
  Kind,
  OperationDefinitionNode,
  OperationTypeNode,
} from 'graphql'

import { Operation } from '../types'

export function isScalar(t: GraphQLOutputType): boolean {
  if (t instanceof GraphQLScalarType || t instanceof GraphQLEnumType) {
    return true
  }

  if (
    t instanceof GraphQLObjectType ||
    t instanceof GraphQLInterfaceType ||
    t instanceof GraphQLUnionType ||
    t instanceof GraphQLList
  ) {
    return false
  }

  const nnt = t as any
  if (nnt instanceof GraphQLNonNull) {
    if (
      nnt.ofType instanceof GraphQLScalarType ||
      nnt.ofType instanceof GraphQLEnumType
    ) {
      return true
    }
  }

  return false
}

export function getTypeForRootFieldName(
  rootFieldName: string,
  operation: Operation,
  schema: GraphQLSchema,
): GraphQLOutputType {
  if (operation === 'mutation' && !schema.getMutationType()) {
    throw new Error(`Schema doesn't have mutation type`)
  }

  if (operation === 'subscription' && !schema.getSubscriptionType()) {
    throw new Error(`Schema doesn't have subscription type`)
  }

  const rootType =
    {
      query: () => schema.getQueryType(),
      mutation: () => schema.getMutationType()!,
      subscription: () => schema.getSubscriptionType()!,
    }[operation]() || undefined!

  const rootField = rootType.getFields()[rootFieldName]

  if (!rootField) {
    throw new Error(`No such root field found: ${rootFieldName}`)
  }

  return rootField.type
}

export function forwardTo(bindingName: string) {
  return <PARENT, ARGS, CONTEXT>(
    parent: PARENT,
    args: ARGS,
    context: CONTEXT,
    info: GraphQLResolveInfo,
  ) => {
    let message = `Forward to '${bindingName}.${info.parentType.name.toLowerCase()}.${
      info.fieldName
    }' failed. `
    if (context[bindingName]) {
      if (
        context[bindingName][info.parentType.name.toLowerCase()][info.fieldName]
      ) {
        return context[bindingName][info.parentType.name.toLowerCase()][
          info.fieldName
        ](args, info)
      } else {
        message += `Field '${info.parentType.name.toLowerCase()}.${
          info.fieldName
        }' not found on binding '${bindingName}'.`
      }
    } else {
      message += `Binding '${bindingName}' not found.`
    }

    throw new Error(message)
  }
}

export function printDocumentFromInfo(info: GraphQLResolveInfo) {
  const fragments = Object.keys(info.fragments).map(
    (fragment) => info.fragments[fragment],
  )
  const selectionSet = info.fieldNodes[0].selectionSet
  if (!selectionSet) {
    throw new Error('Cannot print document without a selection set')
  }

  const operationDefinition: OperationDefinitionNode = {
    kind: Kind.OPERATION_DEFINITION,
    operation: OperationTypeNode.QUERY,
    selectionSet,
  }

  const doc: DocumentNode = {
    kind: Kind.DOCUMENT,
    definitions: [operationDefinition, ...fragments],
  }

  return print(doc)
}
