require "rails_helper"

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

    # Signing in is the only time we ever see the person this endpoint exists for. If the touch
    # lived only on the authenticated read paths, an admin who signs in and abandons /setup would
    # read "never seen" on the very dashboard built to notice them.
    it "records when the admin was last seen" do
      post "/api/sign_ins", headers: workos_headers(sub: "user_01ALICE")

      expect(User.find_by!(workos_user_id: "user_01ALICE").last_seen_at)
        .to be_within(1.second).of(Time.current)
    end

    # The same one-an-hour rule as everywhere else (see LastSeen): a retried callback must not turn
    # into a write, and the endpoint is reachable by anything holding a valid token.
    it "does not re-write last_seen_at for a second sign-in within the hour" do
      post "/api/sign_ins", headers: workos_headers(sub: "user_01ALICE")
      first_seen = User.find_by!(workos_user_id: "user_01ALICE").last_seen_at

      post "/api/sign_ins", headers: workos_headers(sub: "user_01ALICE")

      expect(User.find_by!(workos_user_id: "user_01ALICE").last_seen_at).to eq(first_seen)
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

  # The fix for https://linear.app/bloombase/issue/BLO-1696. A token carries neither an email nor a
  # name unless the WorkOS JWT template has been configured to add them, so the only real admin in
  # production had a placeholder address and no name, and the operator console had nothing to show
  # but "No name yet / Not provided". The web app is not missing them — AuthKit hands its callback
  # the whole WorkOS user object — so the callback forwards them in the body of this very request.
  describe "the identity the callback forwards" do
    it "fills a placeholder address with the address WorkOS holds" do
      post "/api/sign_ins",
        params: { email: "alice@example.com", first_name: "Alice", last_name: "Nkemdirim" },
        headers: workos_headers(sub: "user_01ALICE", email: nil), as: :json

      expect(response).to have_http_status(:no_content)
      expect(User.find_by!(workos_user_id: "user_01ALICE"))
        .to have_attributes(email: "alice@example.com", name: "Alice Nkemdirim")
    end

    it "still accepts a callback that forwards nothing" do
      post "/api/sign_ins", headers: workos_headers(sub: "user_01ALICE", email: nil)

      expect(response).to have_http_status(:no_content)
      expect(User.find_by!(workos_user_id: "user_01ALICE"))
        .to have_attributes(email: "user_01ALICE@users.workos.invalid", name: nil)
    end

    # The body is the caller's word for what they are called; the token is WorkOS's signature on who
    # they are. So the body may fill a gap and may never rewrite a fact — which is what keeps an
    # admin from renaming themselves into somebody else's address on the operator console.
    it "cannot overwrite an address the token itself carried" do
      post "/api/sign_ins",
        params: { email: "impostor@example.com" },
        headers: workos_headers(sub: "user_01ALICE", email: "alice@example.com"), as: :json

      expect(User.find_by!(workos_user_id: "user_01ALICE").email).to eq("alice@example.com")
    end

    # It writes the caller's OWN row and nothing else: the row is found by the token's `sub`, and no
    # field in the body has any say in which row that is.
    it "cannot touch anybody else's row" do
      somebody_else = create(:user, workos_user_id: "user_01BOB", email: "bob@example.com", name: "Bob")

      post "/api/sign_ins",
        params: { workos_user_id: "user_01BOB", id: somebody_else.id, email: "impostor@example.com" },
        headers: workos_headers(sub: "user_01ALICE", email: nil), as: :json

      expect(somebody_else.reload).to have_attributes(email: "bob@example.com", name: "Bob")
      expect(User.find_by!(workos_user_id: "user_01ALICE").email).to eq("impostor@example.com")
    end

    # `users.email` carries no unique index, so the check in User#absorb_workos_identity! is the only
    # thing between a forwarded body and two admins holding one address on the operator console.
    it "cannot claim an address another admin already holds" do
      bob = create(:user, workos_user_id: "user_01BOB", email: "bob@example.com", name: "Bob")

      post "/api/sign_ins",
        params: { email: "bob@example.com", first_name: "Mallory" },
        headers: workos_headers(sub: "user_01ALICE", email: nil), as: :json

      expect(response).to have_http_status(:no_content)
      expect(bob.reload).to have_attributes(email: "bob@example.com", name: "Bob")
      expect(User.find_by!(workos_user_id: "user_01ALICE"))
        .to have_attributes(email: "user_01ALICE@users.workos.invalid", name: "Mallory")
    end

    # The gap-fill is a nicety on an operator console; the `sign_ins` row is the one fact about this
    # request that nothing else in the product can reconstruct. So the fill runs after the row is
    # written and cannot take it down with it, however the body makes it fail.
    it "still records the sign-in when the gap-fill fails outright" do
      allow(WorkosIdentity).to receive(:from_params).and_raise(ArgumentError, "string contains null byte")

      expect {
        post "/api/sign_ins", headers: workos_headers(sub: "user_01ALICE")
      }.to change(SignIn, :count).by(1)

      expect(response).to have_http_status(:no_content)
    end

    it "ignores a field that is not a string rather than storing it" do
      post "/api/sign_ins",
        params: { email: { "$ne" => nil }, first_name: [ 1, 2 ] },
        headers: workos_headers(sub: "user_01ALICE", email: nil), as: :json

      expect(response).to have_http_status(:no_content)
      expect(User.find_by!(workos_user_id: "user_01ALICE"))
        .to have_attributes(email: "user_01ALICE@users.workos.invalid", name: nil)
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
