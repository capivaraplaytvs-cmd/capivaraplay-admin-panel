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

## Publicar uma atualização do APK

1. No SQL Editor do Supabase, execute uma vez `supabase/migrations/202611250001_capivara_update_storage.sql`.
2. No painel, preencha nome e código da versão, escreva as notas e selecione o APK assinado de produção.
3. Aguarde o envio em partes e clique em **Salvar alterações**.
4. Na TV, abra **Mais → Sobre → Verificar atualizações**. O app baixa e confere o arquivo antes de chamar o instalador do Android.

Use um APK do mesmo aplicativo, com código de versão maior e assinado pela mesma chave. O painel divide arquivos de até 180 MB em partes menores que o limite por arquivo do armazenamento gratuito.
## Link direto fixo do APK

O painel também mostra um endereço público permanente para download direto. Ele sempre entrega o APK da versão publicada mais recente como `capivaraplay.apk`, mesmo quando os arquivos enviados são divididos em partes para caber no armazenamento.

Publique a função `supabase/functions/capivaraplay-apk/index.ts` no Supabase como `capivaraplay-apk` e deixe a verificação JWT desativada para permitir o download pelo link público. A configuração versionada em `supabase/config.toml` registra essa opção para o deploy via CLI. A função só lê a configuração pública `capivaraplay-block` e os objetos públicos do bucket `capivara-updates`; não usa chave secreta.

Depois de selecionar o APK no painel, clique em **Salvar alterações**. O link exibido abaixo do envio não muda e passa a apontar para o novo arquivo quando a publicação termina.
