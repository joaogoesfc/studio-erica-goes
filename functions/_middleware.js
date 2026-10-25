// Endereço único do site: www e studio-erica-goes.pages.dev redirecionam (301) para o domínio principal.
// Só age quando CANONICAL_HOST está definido no wrangler.toml — vazio = sem redirecionamento.
// Prévias de publicação (<hash>.studio-erica-goes.pages.dev) não são redirecionadas.

const REDIRECIONAR = ['studio-erica-goes.pages.dev'];

export async function onRequest({ request, next, env }) {
  const alvo = env.CANONICAL_HOST;
  if (alvo) {
    const url = new URL(request.url);
    if (REDIRECIONAR.includes(url.hostname) || url.hostname === `www.${alvo}`) {
      url.protocol = 'https:';
      url.hostname = alvo;
      url.port = '';
      return Response.redirect(url.toString(), 301);
    }
  }
  return next();
}
