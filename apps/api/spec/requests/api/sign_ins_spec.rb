require "rails_helper"

RSpec::Matchers.define_negated_matcher :not_change, :change

# The one funnel event we cannot reconstruct afterwards.
#
# Everything else on the super admin dashboards is computable from rows the product already writes.
# "Somebody signed in" is not: an admin who signs in with WorkOS and abandons /setup never reaches an
# authenticated endpoint, so unless the AuthKit callback tells us at the time, that sign-in is gone.
# This endpoint is what it tells, and these are the four things it has to get right — it must accept
# a token with no house, refuse anything unsigned, record a retry once rather than twice, and touch
# nothing outside the caller's own rows.
RSpec.describe "POST /api/sign_ins" do
  describe "a token WorkOS signed" do
    # The headline case, and the reason this endpoint exists at all. An admin who has not created or
    # joined an organization yet holds a perfectly valid token that names no `org_id` — and is
    # refused everywhere else on this API, on purpose.
    it "accepts a token that names no organization" do
      expect {
        post "/api/sign_ins", headers: workos_headers(sub: "user_01ALICE", org_id: nil)
      }.to change(SignIn, :count).by(1)

      expect(response).to have_http_status(:no_content)
      expect(SignIn.sole.workos_organization_id).to be_nil
      expect(SignIn.sole.user.workos_user_id).to eq("user_01ALICE")
    end

    it "records the organization when the token names one" do
      post "/api/sign_ins", headers: workos_headers(sub: "user_01ALICE", org_id: "org_01FLAT")

      expect(response).to have_http_status(:no_content)
      expect(SignIn.sole.workos_organization_id).to eq("org_01FLAT")
    end

    it "answers with no body at all" do
      post "/api/sign_ins", headers: workos_headers

      expect(response.body).to be_empty
    end
  end

  # The same rules as every other endpoint: the signature is what binds a token to our WorkOS
  # environment, and nothing that fails it may write a row. Accepting a missing `org_id` is the ONLY
  # thing this endpoint relaxes.
  describe "a token that must be refused" do
    it "refuses a token signed by a key the JWKS does not publish" do
      expect {
        post "/api/sign_ins", headers: workos_headers(key: WorkosAuth.foreign_key)
      }.to not_change(SignIn, :count).and not_change(User, :count)

      expect(response).to have_http_status(:unauthorized)
      expect(response.parsed_body).to eq("error" => "unauthorized")
    end

    it "refuses a request with no Authorization header at all" do
      expect { post "/api/sign_ins" }.to not_change(SignIn, :count)

      expect(response).to have_http_status(:unauthorized)
    end

    it "refuses an expired token" do
      post "/api/sign_ins", headers: workos_headers(exp: 1.minute.ago.to_i)

      expect(response).to have_http_status(:unauthorized)
    end

    it "refuses a token issued by someone other than WorkOS" do
      post "/api/sign_ins", headers: workos_headers(iss: "https://evil.example.com/user_management/#{WorkosAuth.client_id}")

      expect(response).to have_http_status(:unauthorized)
    end

    it "refuses a token minted for a different audience" do
      post "/api/sign_ins", headers: workos_headers(aud: "client_01SOME_OTHER_APP")

      expect(response).to have_http_status(:unauthorized)
    end
  end

  # The callback can be retried — by a re-request, a double submit, or Next.js retrying us — and a
  # retry of one sign-in is not two sign-ins. The unique index on `jti` is what settles it, so the
  # test is the same token twice, not the same user twice.
  describe "a retried callback" do
    it "records the same token twice as one sign-in" do
      headers = workos_headers(sub: "user_01ALICE")

      expect { 2.times { post "/api/sign_ins", headers: headers } }.to change(SignIn, :count).by(1)

      expect(response).to have_http_status(:no_content)
    end

    it "still records a genuine second sign-in by the same person" do
      post "/api/sign_ins", headers: workos_headers(sub: "user_01ALICE")

      expect {
        post "/api/sign_ins", headers: workos_headers(sub: "user_01ALICE")
      }.to change(SignIn, :count).by(1).and not_change(User, :count)
    end

    # A token with no `jti` cannot be deduplicated by one, and is recorded rather than refused: the
    # sign-in is real either way, and losing it would be the worse failure. Postgres lets NULLs
    # repeat in a unique index, which is exactly the behaviour this relies on.
    it "records a token that carries no jti" do
      expect {
        2.times { post "/api/sign_ins", headers: workos_headers(sub: "user_01ALICE", jti: nil) }
      }.to change(SignIn, :count).by(2)

      expect(response).to have_http_status(:no_content)
    end
  end

  describe "the user it provisions" do
    it "creates the user on a first sighting, the same way an authenticated request would" do
      expect {
        post "/api/sign_ins", headers: workos_headers(sub: "user_01ALICE", email: "alice@example.com", name: "Alice")
      }.to change(User, :count).by(1)

      expect(User.find_by!(workos_user_id: "user_01ALICE"))
        .to have_attributes(email: "alice@example.com", name: "Alice")
    end

    it "does not invent an email that could be delivered to" do
      post "/api/sign_ins", headers: workos_headers(sub: "user_01ALICE", email: nil)

      expect(User.find_by!(workos_user_id: "user_01ALICE").email).to eq("user_01ALICE@users.workos.invalid")
    end

    it "re-uses the existing user rather than creating a second one" do
      user = create(:user, workos_user_id: "user_01ALICE")

      expect {
        post "/api/sign_ins", headers: workos_headers(sub: "user_01ALICE")
      }.to not_change(User, :count)

      expect(SignIn.sole.user).to eq(user)
    end

    # The endpoint is not tenant-scoped and has no business making a house. A user who signs in
    # without one is the funnel leak the super admin dashboard exists to show, and provisioning a
    # group here would paper over it — as well as putting an untenanted write path beside the
    # tenanted one.
    it "creates no group and no membership, even when the token names an organization" do
      expect {
        post "/api/sign_ins", headers: workos_headers(sub: "user_01ALICE", org_id: "org_01FLAT")
      }.to not_change(Group, :count).and not_change(GroupAdmin, :count)
    end
  end

  # The relaxation is this endpoint's alone. /api/me must still refuse the very token accepted
  # above, or "org_id is optional here" has quietly become "org_id is optional".
  describe "the rest of the API" do
    it "still refuses an organization-less token on /api/me" do
      token = workos_token(sub: "user_01ALICE", org_id: nil)

      post "/api/sign_ins", headers: { "Authorization" => "Bearer #{token}" }
      expect(response).to have_http_status(:no_content)

      get "/api/me", headers: { "Authorization" => "Bearer #{token}" }
      expect(response).to have_http_status(:unauthorized)
    end
  end
end
