require "rails_helper"

# The only place in this app that calls WorkOS, and it is reached from a rake task rather than from
# any request. WebMock blocks the network, so every example here says exactly what WorkOS answered.
RSpec.describe WorkosDirectory do
  let(:user_url) { "https://api.workos.com/user_management/users/user_01ALICE" }

  around do |example|
    original = Rails.application.config.x.workos.api_key
    Rails.application.config.x.workos.api_key = "sk_test_directory"
    example.run
    Rails.application.config.x.workos.api_key = original
  end

  def stub_workos_user(status:, body:)
    stub_request(:get, user_url)
      .to_return(status: status, body: body.to_json, headers: { "Content-Type" => "application/json" })
  end

  it "turns what WorkOS holds into an identity" do
    stub_workos_user(status: 200, body: {
      object: "user", id: "user_01ALICE", email: "alice@example.com",
      first_name: "Alice", last_name: "Nkemdirim"
    })

    identity = described_class.identity("user_01ALICE")

    expect(identity.email).to eq("alice@example.com")
    expect(identity.name).to eq("Alice Nkemdirim")
  end

  it "sends the API key, which is the only reason WorkOS will answer" do
    stub_workos_user(status: 200, body: { object: "user", id: "user_01ALICE", email: "alice@example.com" })

    described_class.identity("user_01ALICE")

    expect(a_request(:get, user_url).with(headers: { "Authorization" => "Bearer sk_test_directory" })).to have_been_made
  end

  # A real outcome rather than an error: a user deleted in WorkOS keeps its row here, because other
  # tables have foreign keys into it.
  it "answers nil when WorkOS has no such user" do
    stub_workos_user(status: 404, body: { message: "User not found" })

    expect(described_class.identity("user_01ALICE")).to be_nil
  end

  # The task walks a list. One row WorkOS cannot answer for must be reportable without being
  # mistaken for "WorkOS says this person has no email". 403 rather than 500 because the gem retries
  # a 500 with a backoff, and a wrong or revoked API key is the likelier failure anyway.
  it "raises rather than answering nil when WorkOS could not answer" do
    stub_workos_user(status: 403, body: { message: "not allowed" })

    expect { described_class.identity("user_01ALICE") }.to raise_error(described_class::Unavailable, /user_01ALICE/)
  end

  describe "with no API key" do
    around do |example|
      original = Rails.application.config.x.workos.api_key
      Rails.application.config.x.workos.api_key = nil
      example.run
      Rails.application.config.x.workos.api_key = original
    end

    it "is not configured" do
      expect(described_class).not_to be_configured
    end

    # Never a silent nil: a backfill that was never configured and a backfill that found nothing
    # must not look the same to the operator running it.
    it "refuses to pretend it asked" do
      expect { described_class.identity("user_01ALICE") }.to raise_error(described_class::NotConfigured)
      expect(a_request(:get, user_url)).not_to have_been_made
    end
  end
end
