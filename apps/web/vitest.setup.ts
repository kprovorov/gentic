import "@testing-library/jest-dom/vitest"

class TestDataTransfer {
  readonly items = {
    files: [] as File[],
    add: (file: File) => {
      this.items.files.push(file)
    },
  }

  get files() {
    return this.items.files
  }
}

Object.defineProperty(globalThis, "DataTransfer", {
  value: TestDataTransfer,
  configurable: true,
})
