# The member magic-link path authenticates by an opaque bearer token — a member's access_token — and
# never by anything in the URL. Every member request spec asks for a member's headers through here so
# that "the token lives in the Authorization header" is expressed in exactly one place.
module MemberAuth
  def member_headers(member)
    { "Authorization" => "Bearer #{member.access_token}" }
  end
end

RSpec.configure do |config|
  config.include MemberAuth, type: :request
end
