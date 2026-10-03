// The request header that carries the page asked for (path and query), in its in-app form
// (proxy.ts sets it after any subdomain rewrite). Layouts have no pathname of
// their own; the affiliate portal reads this to send a V2 user to the V2
// version of a Classic page they followed a link to.
export const PATH_HEADER = "x-tl-pathname"
