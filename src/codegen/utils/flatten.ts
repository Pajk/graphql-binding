import { Interpolation, InterpolationFunction } from '../types'

const flatten = <T>(
  chunks: ReadonlyArray<Interpolation<T>>,
  executionContext: T,
): Interpolation<T>[] => {
  const ruleSet: Interpolation<T>[] = []

  for (const chunk of chunks) {
    if (
      chunk === undefined ||
      chunk === null ||
      chunk === false ||
      chunk === ''
    ) {
      continue
    }

    if (Array.isArray(chunk)) {
      const nested = flatten(
        chunk as ReadonlyArray<Interpolation<any>>,
        executionContext,
      ) as Interpolation<T>[]
      ruleSet.push(...nested)
      continue
    }

    if (typeof chunk === 'function') {
      if (executionContext !== undefined && executionContext !== null) {
        const evaluated = (chunk as InterpolationFunction<T>)(executionContext)
        const nested = flatten(
          [evaluated] as ReadonlyArray<Interpolation<any>>,
          executionContext,
        ) as Interpolation<T>[]
        ruleSet.push(...nested)
      } else {
        ruleSet.push(chunk as Interpolation<T>)
      }
      continue
    }

    ruleSet.push(chunk.toString() as Interpolation<T>)
  }

  return ruleSet
}

export default flatten
