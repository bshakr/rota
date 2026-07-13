require "rails_helper"

RSpec::Matchers.define_negated_matcher :not_change, :change

# The security boundary of the whole product. Rails is stateless: it never asks WorkOS whether a
# session is real, so a token that gets past this file is believed completely. Everything below
# is therefore about what must NOT get past it.
#
# GET /api/me is used as the probe because it is the one endpoint that exists; the behaviour under
# test belongs to Authenticatable, and every future endpoint inherits it from Api::BaseController.
RSpec.describe "WorkOS JWT authentication" do
  describe "a token WorkOS signed" do
    it "is accepted" do
      get "/api/me", headers: workos_headers

      expect(response).to have_http_status(:ok)
    end
  end

  describe "a token that must be refused" do
    it "refuses a request with no Authorization header at all" do
      get "/api/me"

      expect(response).to have_http_status(:unauthorized)
    end

    it "refuses an Authorization header that is not a bearer token" do
      get "/api/me", headers: { "Authorization" => "Basic #{Base64.strict_encode64('alice:hunter2')}" }

      expect(response).to have_http_status(:unauthorized)
    end

    it "refuses an expired token" do
      get "/api/me", headers: workos_headers(exp: 1.minute.ago.to_i)

      expect(response).to have_http_status(:unauthorized)
    end

    # The one that matters. The signature is what binds a token to our WorkOS environment: the
    # JWKS is served per client id, so a key WorkOS never published for us can say anything it
    # likes about org_id and still be worthless.
    it "refuses a token signed by a key the JWKS does not publish" do
      get "/api/me", headers: workos_headers(key: WorkosAuth.foreign_key)

      expect(response).to have_http_status(:unauthorized)
    end

    # Same forged key, but announcing the real kid, so the app finds a key to check against and
    # the signature simply fails to verify. This is the case a lazy `kid` lookup gets wrong.
    it "refuses a forged token that claims a kid the JWKS does publish" do
      get "/api/me", headers: workos_headers(key: WorkosAuth.foreign_key, kid: WorkosAuth::KID)

      expect(response).to have_http_status(:unauthorized)
    end

    it "refuses a token whose signature has been tampered with" do
      header, payload, = workos_token.split(".")
      forged = [ header, payload, Base64.urlsafe_encode64("not-a-signature", padding: false) ].join(".")

      get "/api/me", headers: { "Authorization" => "Bearer #{forged}" }

      expect(response).to have_http_status(:unauthorized)
    end

    it "refuses an unsigned token, however well-formed" do
      payload = { sub: "user_01ALICE", org_id: "org_01FLAT", role: "admin", exp: 5.minutes.from_now.to_i }

      get "/api/me", headers: { "Authorization" => "Bearer #{JWT.encode(payload, nil, 'none')}" }

      expect(response).to have_http_status(:unauthorized)
    end

    it "refuses a token issued by someone other than WorkOS" do
      get "/api/me", headers: workos_headers(iss: "https://evil.example.com/user_management/#{WorkosAuth.client_id}")

      expect(response).to have_http_status(:unauthorized)
    end

    it "refuses a token WorkOS issued for a different client id" do
      get "/api/me", headers: workos_headers(iss: "https://api.workos.com/user_management/client_01SOMEONE_ELSE")

      expect(response).to have_http_status(:unauthorized)
    end

    # WorkOS's AuthKit access token carries no `aud` at all, so this is not "aud missing" — it is
    # a token minted for a *different* audience, e.g. some other OAuth application in the same
    # WorkOS environment, signed by the very same keys. Accepting it would make this API a
    # confused deputy for whatever that application is.
    it "refuses a token whose audience is somebody else" do
      get "/api/me", headers: workos_headers(aud: "client_01SOME_OTHER_APP")

      expect(response).to have_http_status(:unauthorized)
    end

    it "accepts a token whose audience is us" do
      get "/api/me", headers: workos_headers(aud: WorkosAuth.client_id)

      expect(response).to have_http_status(:ok)
    end

    # No org_id means the admin has not selected an organization, so there is no tenant to scope
    # them to. There is nothing they could be allowed to do, so they are allowed nothing.
    it "refuses a token that names no organization" do
      get "/api/me", headers: workos_headers(org_id: nil)

      expect(response).to have_http_status(:unauthorized)
    end

    it "tells the client nothing about why it was refused" do
      get "/api/me", headers: workos_headers(key: WorkosAuth.foreign_key)

      expect(response.parsed_body).to eq("error" => "unauthorized")
    end

    it "provisions nothing from a token it refused" do
      expect {
        get "/api/me", headers: workos_headers(key: WorkosAuth.foreign_key)
      }.to not_change(User, :count).and not_change(Group, :count).and not_change(GroupAdmin, :count)
    end
  end

  # Rails keeps no independent copy of WorkOS's membership state to drift out of sync. These rows
  # are rebuilt from the verified claims on every request instead — so they must be idempotent,
  # and they must be safe when the first page load fires several requests at once.
  describe "just-in-time provisioning from the verified claims" do
    it "creates the user, the group and the group_admin on the first request" do
      expect {
        get "/api/me", headers: workos_headers(sub: "user_01ALICE", org_id: "org_01FLAT", role: "admin")
      }.to change(User, :count).by(1).and change(Group, :count).by(1).and change(GroupAdmin, :count).by(1)

      expect(User.last.workos_user_id).to eq("user_01ALICE")
      expect(Group.last.workos_organization_id).to eq("org_01FLAT")
      expect(GroupAdmin.last).to have_attributes(user: User.last, group: Group.last, role: "admin")
    end

    it "creates nothing on the second request" do
      get "/api/me", headers: workos_headers

      expect {
        get "/api/me", headers: workos_headers
      }.to not_change(User, :count).and not_change(Group, :count).and not_change(GroupAdmin, :count)
    end

    it "re-syncs the role from the claim, because WorkOS owns it" do
      get "/api/me", headers: workos_headers(role: "admin")
      get "/api/me", headers: workos_headers(role: "member")

      expect(GroupAdmin.sole.role).to eq("member")
    end

    it "joins an existing group rather than creating a second one for the same organization" do
      group = create(:group, workos_organization_id: "org_01FLAT", name: "Flat 3, Alma Road")

      expect {
        get "/api/me", headers: workos_headers(org_id: "org_01FLAT")
      }.to change(GroupAdmin, :count).by(1).and not_change(Group, :count)

      expect(GroupAdmin.sole.group).to eq(group)
    end

    # The group's real name and timezone are set by an admin in settings; WorkOS's token carries
    # neither. Re-writing the placeholder on every request would silently undo that.
    it "never overwrites a group an admin has already named" do
      create(:group, workos_organization_id: "org_01FLAT", name: "Flat 3, Alma Road", timezone: "Europe/London")

      get "/api/me", headers: workos_headers(org_id: "org_01FLAT")

      expect(Group.sole).to have_attributes(name: "Flat 3, Alma Road", timezone: "Europe/London")
    end

    it "takes the user's email and name from the claims when WorkOS's JWT template supplies them" do
      get "/api/me", headers: workos_headers(sub: "user_01ALICE", email: "alice@example.com", name: "Alice")

      expect(User.sole).to have_attributes(email: "alice@example.com", name: "Alice")
    end

    # Provisioning runs on every authenticated request, but that request is almost always a
    # steady-state read by an admin who already exists and whose role has not changed. That path
    # must not write — otherwise a single valid-token holder drives unbounded write load through
    # plain GETs, and these reads could never be served from a read replica.
    it "writes nothing on a steady-state request whose role is unchanged" do
      get "/api/me", headers: workos_headers(role: "admin")

      writes = sql_writes_during do
        get "/api/me", headers: workos_headers(role: "admin")
      end

      expect(response).to have_http_status(:ok)
      expect(writes).to be_empty
    end

    it "writes only to re-sync the role, not to touch the user or group, when the role changes" do
      get "/api/me", headers: workos_headers(role: "admin")

      writes = sql_writes_during do
        get "/api/me", headers: workos_headers(role: "member")
      end

      expect(GroupAdmin.sole.role).to eq("member")
      expect(writes).to be_present
      expect(writes).to all(match(/UPDATE "group_admins"/i))
    end
  end

  # Current is process state, reused by the next request the thread picks up. If it survived a
  # request, that next request would begin life inside the previous admin's group.
  describe "Current" do
    it "is reset when the request ends" do
      get "/api/me", headers: workos_headers

      expect(Current.group_admin).to be_nil
      expect(Current.group).to be_nil
      expect(Current.user).to be_nil
    end
  end

  # An un-cached JWKS is a network round trip in front of every single API call, and a hard
  # dependency on WorkOS being up for the API to answer at all.
  describe "the JWKS key set" do
    include ActiveSupport::Testing::TimeHelpers

    it "is fetched once across two requests" do
      get "/api/me", headers: workos_headers
      get "/api/me", headers: workos_headers

      expect(response).to have_http_status(:ok)
      expect(a_request(:get, WorkosAuth.jwks_url)).to have_been_made.once
    end

    it "is fetched once across two requests from different admins in different groups" do
      get "/api/me", headers: workos_headers(sub: "user_01ALICE", org_id: "org_01FLAT")
      get "/api/me", headers: workos_headers(sub: "user_01BOB", org_id: "org_01HOUSE")

      expect(a_request(:get, WorkosAuth.jwks_url)).to have_been_made.once
    end

    # A token naming a kid we have never seen is either a key rotation we have not noticed, or
    # somebody feeding us junk to make us call WorkOS on their behalf. It must not cost a fetch
    # per request, which is what the refetch floor buys.
    it "does not refetch per request when a token names a kid it has never seen" do
      3.times { get "/api/me", headers: workos_headers(kid: "a-kid-workos-never-published") }

      expect(response).to have_http_status(:unauthorized)
      expect(a_request(:get, WorkosAuth.jwks_url)).to have_been_made.once
    end

    # ...but a real rotation still has to be picked up without waiting out the cache TTL.
    it "refetches for an unknown kid once the refetch floor has passed" do
      get "/api/me", headers: workos_headers

      rotated_jwks = { keys: [ JWT::JWK.new(WorkosAuth.foreign_key, kid: "rotated-key").export ] }
      stub_request(:get, WorkosAuth.jwks_url)
        .to_return(status: 200, body: rotated_jwks.to_json, headers: { "Content-Type" => "application/json" })

      travel 1.minute do
        get "/api/me", headers: workos_headers(key: WorkosAuth.foreign_key, kid: "rotated-key")
      end

      expect(response).to have_http_status(:ok)
      expect(a_request(:get, WorkosAuth.jwks_url)).to have_been_made.twice
    end

    it "answers 503, not 401, when WorkOS cannot be reached" do
      stub_request(:get, WorkosAuth.jwks_url).to_timeout

      get "/api/me", headers: workos_headers

      expect(response).to have_http_status(:service_unavailable)
    end

    it "does not cache a failed fetch" do
      stub_request(:get, WorkosAuth.jwks_url).to_return(status: 500)
      get "/api/me", headers: workos_headers
      expect(response).to have_http_status(:service_unavailable)

      stub_workos_jwks
      get "/api/me", headers: workos_headers

      expect(response).to have_http_status(:ok)
    end
  end
end
