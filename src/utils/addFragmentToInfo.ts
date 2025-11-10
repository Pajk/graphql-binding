import {
  GraphQLResolveInfo,
  GraphQLScalarType,
  parse,
  FragmentDefinitionNode,
  Kind,
} from 'graphql'
import { getDeepType } from '../info'
import * as immutable from 'object-path-immutable'

export function addFragmentToInfo(
  info: GraphQLResolveInfo,
  fragment: string,
): GraphQLResolveInfo {
  const returnType = getDeepType(info.returnType)
  if (returnType instanceof GraphQLScalarType) {
    throw new Error(
      `Can't add fragment "${fragment}" because return type of info object is a scalar type ${info.returnType.toString()}`,
    )
  }

  const ast = parse(fragment)

  const deepReturnType = getDeepType(returnType)

  const [definition] = ast.definitions

  if (
    definition &&
    definition.kind === Kind.FRAGMENT_DEFINITION &&
    (definition as FragmentDefinitionNode).typeCondition.name.value !==
      deepReturnType.toString()
  ) {
    throw new Error(
      `Type ${
        (ast.definitions[0] as FragmentDefinitionNode).typeCondition.name.value
      } specified in fragment doesn't match return type ${deepReturnType.toString()}`,
    )
  }

  const hasSelectionSet =
    definition &&
    'selectionSet' in definition &&
    definition.selectionSet &&
    Array.isArray(definition.selectionSet.selections)

  const selectionsToAdd = hasSelectionSet
    ? definition.selectionSet!.selections
    : []

  return (immutable as any).update(
    info,
    ['fieldNodes', 0, 'selectionSet', 'selections'],
    (selections) => selections.concat(selectionsToAdd),
  )
}
