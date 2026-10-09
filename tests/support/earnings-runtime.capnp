using Workerd = import "/workerd.capnp";
const config :Workerd.Config = (
 services = [
  (name = "earnings-auth", worker = (
   compatibilityDate = "2026-09-13",
   globalOutbound = "auth-upstream",
   modules = [
    (name = "earnings-runtime", esModule = embed "earnings-runtime.mjs")
   ]
  )),
  (name = "auth-upstream", worker = (
   compatibilityDate = "2026-09-13",
   modules = [(name = "upstream", esModule = embed "earnings-auth-upstream.mjs")]
  ))
 ]
);
