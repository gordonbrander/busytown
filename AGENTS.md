## General code style

- **Write code in a pragmatic functional style**
  - Prefer pure functions and data over classes.
    - But if an API wants a class, it's ok to use a class.
  - "Pragmatic" means the code looks "normal". Avoid overly-fancy functional patterns, such as currying or point-free style, that don't work well in multi-paradigm languages.
- **Factor out**: extract pure functions for common logic and reusable operations
- **Minimize side effects**: Aim for functional core, imperative shell.
- **Channel the spirit of Rich Hickey**: Embrace simplicity, embrace immutability, embrace data.
  - Also consider the lessons of Erlang (Joe Armstrong), Elixir (José Valim), Elm (Evan Czaplicki), and Rust.

## Typescript style guide

- Write Typescript code in a pragmatic functional style.
- Prefer arrow functions to function declarations
  - Include return type in function declaration
- Prefer types to interfaces unless there's a good reason to use interfaces
- When using namespace imports, use uppercase module names (`import * as Module from "./module.ts"`)
- Import using file extension (`import * as Module from "./module.ts"`) when writing for Deno or the web.
- When importing types, use `type` keyword (`import { type Foo } from "./module.ts"`)
- Export at the point of definition, not at the end of the file.
- Prefer `map`, `filter`, and `reduce`, for immutable array transformations.
  - Prefer `for-of` over `forEach` for mutable array transformations.
- Prefer undefined to null when dealing with optional values.
- When writing private fields or methods use the native `#field` syntax instead of the Typescript `private field` syntax.
- When you need a class method to have a hard-bound `this`, write it as a class field and an arrow function (`method = () => {}`).
