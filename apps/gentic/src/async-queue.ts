/**
 * Minimal unbounded async queue: `push` never blocks, `next` resolves as soon
 * as an item is available. Used to feed follow-up chat messages into a live
 * ACP session between prompt turns.
 */
export class AsyncQueue<T> {
  private items: T[] = []
  private resolvers: Array<(value: T) => void> = []

  push(item: T): void {
    const resolve = this.resolvers.shift()
    if (resolve) {
      resolve(item)
    } else {
      this.items.push(item)
    }
  }

  next(): Promise<T> {
    if (this.items.length > 0) {
      return Promise.resolve(this.items.shift() as T)
    }
    return new Promise<T>((resolve) => {
      this.resolvers.push(resolve)
    })
  }
}
