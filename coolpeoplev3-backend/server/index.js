// Entry point. Configuration is checked BEFORE anything connects or listens:
// a server that boots with a broken half is worse than one that refuses, and
// every failure this catches used to surface days later as a dead link in
// somebody's email or an address lookup that threw for one user.
require("./config/requiredEnv.js").checkEnv();

// DB/index.js connects the pg client, mounts the routers, starts scheduled
// jobs, and listens — so requiring it boots the whole server.
require("./DB/index.js");
