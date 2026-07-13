namespace :workos do
  # Settle the aud/issuer ambiguity from a REAL token, not from the docs.
  #
  # A WorkOS AuthKit access token is documented to carry no `aud`, and its issuer is documented in
  # two different forms. WorkosAccessToken is written to be correct whichever way the real token
  # turns out — but when real WorkOS keys are wired up (BLO-1057), this is how a human sees what a
  # real token actually contains, so the hedge can be replaced with a fact.
  #
  #   bin/rails 'workos:inspect_token[eyJhbGci...]'
  #
  # It verifies the signature and expiry against the live JWKS (the same path a request takes) and
  # prints the full header and claims, plus whether the issuer and audience checks would pass. It
  # does not enforce those checks, so a wrong issuer or audience is shown rather than hidden.
  desc "Verify a real WorkOS token against the live JWKS and print its claims. Usage: bin/rails 'workos:inspect_token[<jwt>]'"
  task :inspect_token, [ :token ] => :environment do |_task, args|
    token = args[:token].to_s.strip.delete_prefix("Bearer ")
    abort "Usage: bin/rails 'workos:inspect_token[<jwt>]'" if token.empty?

    result = WorkosAccessToken.inspect_claims(token)

    puts "Header:"
    puts JSON.pretty_generate(result[:header])
    puts "\nClaims:"
    puts JSON.pretty_generate(result[:payload])
    puts "\nissuer_trusted:    #{result[:issuer_trusted]}   (iss = #{result[:payload]['iss'].inspect})"
    puts "audience_accepted: #{result[:audience_accepted]}   (aud = #{result[:payload]['aud'].inspect})"
  rescue WorkosAccessToken::InvalidToken, JWT::DecodeError => e
    abort "Token failed verification: #{e.class}: #{e.message}"
  rescue WorkosAccessToken::KeySetUnavailable => e
    abort "Could not reach the JWKS to verify: #{e.message}"
  end
end
