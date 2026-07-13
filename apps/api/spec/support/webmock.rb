require "webmock/rspec"

# No spec is allowed to touch the network. Twilio, WorkOS and its JWKS endpoint all get
# stubbed; an unstubbed request raises with the exact stub you need, rather than hanging
# or — worse — sending a real text message.
WebMock.disable_net_connect!(allow_localhost: true)
