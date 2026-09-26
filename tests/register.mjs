// Unit tests run on plain Node (22.6+: --experimental-strip-types), no test
// framework or bundler. This registers the resolver below.
import { register } from "node:module"
register("./alias-hooks.mjs", import.meta.url)
