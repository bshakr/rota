# Rails never calls WorkOS. It verifies the JWT that Next.js forwards against WorkOS's published
# key set, and the only thing it needs in order to do that is the client id, which is what names
# the key set: https://api.workos.com/sso/jwks/<client_id>. No API key, no network call at boot.
#
# (The workos gem builds that URL for us. In 9.5 `UserManagement` is instantiated with a client
# rather than being a singleton, so the call is not the `WorkOS::UserManagement.get_jwks_url(id)`
# of the ticket — same endpoint, different shape.)

client_id = ENV["WORKOS_CLIENT_ID"].presence

# In production a missing client id means there is no key set to verify against, so every single
# request is unauthenticated. Fail at boot, loudly, rather than serve a 401 to every admin.
if client_id.blank? && Rails.env.production?
  raise "WORKOS_CLIENT_ID must be set. Without it there is no JWKS to verify tokens against, " \
        "and every authenticated request would be refused."
end

# Test signs its own tokens and stubs the JWKS endpoint (spec/support/workos_auth.rb). It needs
# both sides to agree on a client id, not a real one.
client_id ||= "client_test" if Rails.env.test?

Rails.application.config.x.workos.client_id = client_id

if client_id.present?
  jwks_url = WorkOS::Client.new(client_id: client_id).user_management.get_jwks_url(client_id: client_id)

  Rails.application.config.x.workos.jwks_url = jwks_url
  # Every issuer we will trust has to live on the same host that serves the key set — which is
  # api.workos.com, or a custom auth domain if one is configured on the WorkOS client.
  Rails.application.config.x.workos.api_origin = URI(jwks_url).then { |uri| "#{uri.scheme}://#{uri.host}" }
end

# WorkOS documents the issuer both as `https://api.workos.com/user_management/<client_id>` and as
# the bare `https://api.workos.com/`, and a custom auth domain changes it again. Guessing wrong is
# a total auth outage, so WorkosAccessToken accepts either documented form on the trusted host —
# and this pins it to one exact string when you know what yours is.
Rails.application.config.x.workos.issuer = ENV["WORKOS_JWT_ISSUER"].presence
