require "rails_helper"

# The privacy contract of docs/sentry-error-logging.md §3, asserted against a REAL event object.
#
# The five fixtures below are the five secrets that can reach an event as prose rather than as a
# named field, which is why no deny list catches them: Twilio quotes the recipient's number in its
# own error messages, a magic link turns up in a URL or a rendered body, a bare access token is
# what a log-derived breadcrumb carries, and an admin's email address is quoted back by WorkOS and
# by any validation message about it. The same five literals are asserted on the web side in
# apps/web/src/lib/observability/scrub.test.ts; they are copied rather than shared because they are
# in two languages, and each file names the other.
#
# The last assertion in each case is the one that matters: the WHOLE serialised event contains none
# of them. A field the walker does not know about fails this spec instead of leaking.
RSpec.describe SentryScrubber do
  include Sentry::TestHelper

  let(:phone) { "+447700900123" }
  let(:token) { "OwJtLMMuj5l3wknvx5zfH6rAV0E6BA2tUzi4ADr-Qws" }
  let(:magic_link) { "https://rota.monster/s/#{token}" }
  let(:bearer) { "Bearer #{token}" }
  let(:email) { "alice@example.com" }

  # A DSN is needed for the client to build an event at all, and DummyTransport is what keeps this
  # spec off the network. See spec/support/webmock.rb for the belt to that pair of braces.
  before { setup_sentry_test }
  after { teardown_sentry_test }

  # An event carrying all five fixtures in every field the plan names, built the way the SDK builds
  # one rather than stubbed, so a change in the gem's event shape shows up here.
  def event_with_everything
    event = Sentry.get_current_client.event_from_exception(
      RuntimeError.new("Unable to create record: The 'To' number #{phone} is not a valid phone number")
    )
    event.rack_env = Rack::MockRequest.env_for("https://api.example/api/member/shifts")
    event.message = "texting #{phone} failed"
    event.transaction = "GET /s/#{token}"
    event.tags = { magic_link: magic_link }
    event.extra = { body: "Your Rota Monster personal link: #{magic_link}" }
    event.contexts = { "rails.error" => { sms_message_id: 12, phone: phone, token: token, invited: email } }
    # Set by hand on top of the deny list in config/initializers/sentry.rb, which is the point: this
    # is what the event looks like the day somebody edits a term out of that list.
    event.request.headers = { "Authorization" => bearer, "X-Twilio-Signature" => token }
    event.breadcrumbs = Sentry::BreadcrumbBuffer.new(5).tap do |buffer|
      buffer.record(
        Sentry::Breadcrumb.new(
          category: "send",
          message: "POST /Messages.json to #{phone}",
          data: { url: magic_link, authorization: bearer, token: token }
        )
      )
    end
    event
  end

  def serialised(event)
    JSON.generate(event.to_json_compatible)
  end

  # Raised rather than constructed, so the event carries a real backtrace and the frames carry the
  # source lines around it. The number below is deliberately a literal in this file: that is what a
  # frame's context lines pick up.
  def exception_raised_near_a_phone_number
    raise "Twilio refused +447700900123"
  rescue RuntimeError => e
    e
  end

  describe ".call" do
    it "returns the event, because before_send treats a nil return as 'drop this'" do
      event = event_with_everything

      expect(described_class.call(event)).to equal(event)
    end

    it "leaves no phone number, magic link, bearer token, bare token or email anywhere in the event" do
      json = serialised(described_class.call(event_with_everything))

      expect(json).not_to include(phone)
      expect(json).not_to include(token)
      expect(json).not_to include("Bearer #{token}")
      expect(json).not_to include(email)
    end

    it "keeps enough of each to be worth reading" do
      json = serialised(described_class.call(event_with_everything))

      expect(json).to include("[phone]", "/s/[token]", "Bearer [filtered]", "[token]", "[email]")
      # The parts of the event that were never a secret survive intact.
      expect(json).to include("Unable to create record", "sms_message_id")
    end

    # Found by this spec rather than by review: with frame_context_lines set, every frame ships the
    # three source lines either side of it, so a literal near the raise leaves the building with it.
    it "scrubs the source lines that travel with each stack frame" do
      event = Sentry.get_current_client.event_from_exception(exception_raised_near_a_phone_number)

      json = serialised(described_class.call(event))

      expect(json).to include("context_line")
      expect(json).not_to include(phone)
    end

    it "rewrites each field the plan names, so a failure says which one regressed" do
      event = described_class.call(event_with_everything)

      expect(event.message).to eq("texting [phone] failed")
      expect(event.transaction).to eq("GET /s/[token]")
      expect(event.tags[:magic_link]).to eq("https://rota.monster/s/[token]")
      expect(event.extra[:body]).to eq("Your Rota Monster personal link: https://rota.monster/s/[token]")
      expect(event.contexts["rails.error"][:phone]).to eq("[phone]")
      expect(event.contexts["rails.error"][:token]).to eq("[token]")
      expect(event.contexts["rails.error"][:invited]).to eq("[email]")
      expect(event.contexts["rails.error"][:sms_message_id]).to eq(12)
      expect(event.request.headers["Authorization"]).to eq("Bearer [filtered]")
      expect(event.request.headers["X-Twilio-Signature"]).to eq("[token]")
      expect(event.exception.values.first.value).to include("[phone]")

      crumb = event.breadcrumbs.peek
      expect(crumb.message).to eq("POST /Messages.json to [phone]")
      expect(crumb.data).to eq(
        url: "https://rota.monster/s/[token]",
        authorization: "Bearer [filtered]",
        token: "[token]"
      )
    end
  end

  describe ".scrub_string" do
    it "rewrites an E.164 number wherever it appears in a sentence" do
      expect(described_class.scrub_string("to #{phone}.")).to eq("to [phone].")
    end

    it "keeps the shape of a magic link while losing the token" do
      expect(described_class.scrub_string(magic_link)).to eq("https://rota.monster/s/[token]")
    end

    it "rewrites a bearer credential of any shape, JWT or member token" do
      expect(described_class.scrub_string(bearer)).to eq("Bearer [filtered]")
      expect(described_class.scrub_string("Bearer eyJhbGciOiJSUzI1NiJ9.e30.sig")).to eq("Bearer [filtered]")
    end

    # The rule the first three miss: the 43-character token standing on its own, which is what a
    # log line or a job argument would carry.
    it "rewrites a bare 32-byte URL-safe token, including one that ends in a dash or underscore" do
      expect(described_class.scrub_string("token=#{token} used")).to eq("token=[token] used")
      ending_in_dash = "#{token[0..41]}-"
      expect(described_class.scrub_string("token=#{ending_in_dash} used")).to eq("token=[token] used")
    end

    it "rewrites an email address wherever it is quoted" do
      expect(described_class.scrub_string("invite to #{email} bounced")).to eq("invite to [email] bounced")
    end

    it "leaves an ordinary sentence alone, so events stay readable" do
      expect(described_class.scrub_string("rota 12 has no members")).to eq("rota 12 has no members")
    end
  end
end
