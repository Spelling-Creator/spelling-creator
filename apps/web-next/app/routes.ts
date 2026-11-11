// The route table.
//
// Every page sits inside one layout route, the shell, which is what makes
// the chrome identical everywhere. The one route outside it, when it moves
// here, is /oauth/authorize: the MCP consent screen, where app navigation
// would be an invitation to wander off mid-grant.
//
// The table grows a route at a time while the old app (apps/web) still
// serves the rest of the site; lib/routes.ts says which paths are here and
// the catch-all hands the others back to the browser. See
// apps/docs/docs/developers/web-app/rewrite.md.

import { type RouteConfig, layout, route } from "@react-router/dev/routes";

export default [
  layout("routes/shell.tsx", [
    route("hub", "routes/hub.tsx"),
    route("users/:id", "routes/profile.tsx"),
    route("*", "routes/not-found.tsx"),
  ]),
] satisfies RouteConfig;
