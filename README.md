# Painel remoto CapivaraPlay

Painel web para administrar os banners e os três endereços de servidor do CapivaraPlay Block. O app Android e a migração SQL não fazem parte deste repositório.

## Publicação

1. Em **Settings → Secrets and variables → Actions → Variables**, configure `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY`.
2. Em **Settings → Pages**, selecione **GitHub Actions** como fonte.
3. Em **Actions**, execute **Deploy CapivaraPlay admin panel**.
4. Abra o endereço indicado no resultado do workflow.

A chave publishable é destinada a clientes públicos. Nunca configure a chave `service_role` ou qualquer `sb_secret_...` no GitHub Pages, no painel ou no app.

## Segurança do painel

O acesso ao painel usa Supabase Auth. Alterações e upload de banners exigem um usuário cadastrado na tabela `app_panel_admins`; a leitura pública da configuração é controlada por RLS. O site é público, mas os controles administrativos exigem login autorizado.

## App Android

Para ativar a leitura da configuração remota no build do app, configure `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` como variáveis de ambiente antes de compilar o flavor `block`. Sem essas variáveis, o app mantém as configurações locais existentes.

