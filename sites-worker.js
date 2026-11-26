// Cloudflare Worker entry: the game is a fully static bundle, so every request
// is answered by the Assets binding.
export default {
  fetch(request, env) {
    return env.ASSETS.fetch(request);
  }
};
