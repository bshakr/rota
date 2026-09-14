require "rails_helper"

RSpec.describe NewSignupAlertJob do
  include ActiveJob::TestHelper

  let(:alert_number) { "+447911123456" }

  # The number is resolved at boot from SIGNUP_ALERT_PHONE (see SmsBoot.signup_alert_phone_for), so
  # a spec cannot set an env var and expect it to matter. Stubbing the resolved value is also what
  # keeps the suite honest about the default: unset is what test boots with, so every other spec in
  # this repo proves that a signup texts nobody unless somebody asked for it.
  def alert_phone(number)
    allow(Rails.configuration.x.sms).to receive(:signup_alert_phone).and_return(number)
  end

  # The body of the one text Twilio was asked to send. WebMock runs the block against every request
  # it recorded, which is how the body comes back out of the matcher.
  def texted_body
    body = nil
    expect(a_request(:post, TwilioStubs::MESSAGES_URL_PATTERN).with { |request|
      body = Rack::Utils.parse_nested_query(request.body)["Body"]
    }).to have_been_made.once
    body
  end

  before { alert_phone(alert_number) }

  describe "the text an operator gets" do
    let(:user) { create(:user, name: "Jane Doe", email: "jane@example.com") }

    it "names who signed up, how to reach them, and what they called their house" do
      stub_twilio_send
      create(:group_admin, user: user, group: create(:group, name: "The Beeches"))

      described_class.perform_now(user.id)

      expect(texted_body).to eq("New Rota Monster signup: Jane Doe <jane@example.com>. House: The Beeches. Admins so far: 1.")
    end

    it "sends it to the configured operator number, and to nobody else" do
      stub_twilio_send
      user

      described_class.perform_now(user.id)

      expect(a_request(:post, TwilioStubs::MESSAGES_URL_PATTERN).with { |request|
        Rack::Utils.parse_nested_query(request.body)["To"] == alert_number
      }).to have_been_made.once
    end

    # An AuthKit token carries no name, and a minute is not always long enough for the sign-in
    # callback to have filled one in. "someone signed up" is still worth hearing.
    it "falls back to someone when nothing has named them yet" do
      stub_twilio_send
      nameless = create(:user, name: nil, email: "jane@example.com")

      described_class.perform_now(nameless.id)

      expect(texted_body).to include("New Rota Monster signup: someone <jane@example.com>.")
    end

    it "treats a name of spaces as no name at all" do
      stub_twilio_send
      blank = create(:user, name: "   ", email: "jane@example.com")

      described_class.perform_now(blank.id)

      expect(texted_body).to include("signup: someone <")
    end

    # The stand-in address is not deliverable and never will be, so handing it to an operator would
    # be handing them something to try to write to.
    it "says no email shared rather than texting the placeholder address" do
      stub_twilio_send
      placeholder = create(:user, name: "Jane Doe", email: User.placeholder_email("user_01JANE"))

      described_class.perform_now(placeholder.id)

      expect(texted_body).to include("New Rota Monster signup: Jane Doe, no email shared.")
      expect(texted_body).not_to include(User::PLACEHOLDER_EMAIL_DOMAIN)
    end

    # The normal reading a minute after signup: the user row exists, and the house arrives on the
    # admin's next request.
    it "says none yet when there is no house" do
      stub_twilio_send

      described_class.perform_now(user.id)

      expect(texted_body).to include("House: none yet.")
    end

    it "says not named yet when the house is still wearing its provisioning placeholder" do
      stub_twilio_send
      group = create(:group, workos_organization_id: "org_01FLAT", name: Group.placeholder_name("org_01FLAT"))
      create(:group_admin, user: user, group: group)

      described_class.perform_now(user.id)

      expect(texted_body).to include("House: not named yet.")
    end

    it "counts the admins signed up so far" do
      stub_twilio_send
      create_list(:user, 3)

      described_class.perform_now(user.id)

      expect(texted_body).to end_with("Admins so far: 4.")
    end
  end

  # A name is whatever a stranger typed into AuthKit, and half the characters a person can type cost
  # more than one GSM-7 septet: an accent takes the whole message to UCS-2 and its 70 character
  # ceiling, an emoji costs more again, and a brace or a tilde quietly costs two. So nothing reaches
  # the body until it has been flattened to characters that cost one each.
  describe "a name or a house name with characters GSM-7 cannot carry" do
    it "transliterates accents and drops emoji rather than sending a UCS-2 message" do
      stub_twilio_send
      user = create(:user, name: "Zoë Café 🎉", email: "zoe@example.com")

      described_class.perform_now(user.id)

      body = texted_body
      expect(body).to be_ascii_only
      expect(body).to include("Zoe Cafe <zoe@example.com>")
    end

    it "collapses newlines and runs of spaces a paste left behind" do
      stub_twilio_send
      user = create(:user, name: "Jane\n   van   Doe  ", email: "jane@example.com")

      described_class.perform_now(user.id)

      expect(texted_body).to include("signup: Jane van Doe <")
    end

    # Braces are in the GSM-7 extension table, not the basic one: they look like punctuation and
    # cost two septets each.
    it "drops the braces out of a house name" do
      stub_twilio_send
      user = create(:user, name: "Jane Doe", email: "jane@example.com")
      create(:group_admin, user: user, group: create(:group, name: "Flat {2}"))

      described_class.perform_now(user.id)

      expect(texted_body).to include("House: Flat 2.")
    end
  end

  # Three fields a stranger chose, on a message that costs per segment. A name long enough to make
  # this a three-segment text is not a scenario to hope does not happen.
  describe "a name, an address and a house name that are all far too long" do
    let(:long_name) { "Jane #{'Doe' * 100}" }
    let(:long_house) { "The #{'Beeches' * 100}" }

    it "carries the address whole and gives the name and the house what is left" do
      stub_twilio_send
      email = "alexandra.constantinopoulos@hollandandbarrett.example"
      user = create(:user, name: long_name, email: email)
      create(:group_admin, user: user, group: create(:group, name: long_house))

      described_class.perform_now(user.id)

      body = texted_body
      expect(body.length).to be <= NewSignupAlertJob::MAX_BODY_LENGTH
      # Whole, between the angle brackets. A trimmed address reads as deliverable and is not.
      expect(body).to include("<#{email}>")
      expect(body).to include(long_name.first(12), long_house.first(12))
      # The count is the last thing in the body and is never shaved, so an alert can always be read
      # for the one number it carries.
      expect(body).to end_with("Admins so far: 1.")
    end

    # Past the point where the address and twelve characters each of the other two fit together, the
    # address goes rather than the name and the house. The operator can still look the person up.
    it "says the address was too long rather than texting half of one" do
      stub_twilio_send
      user = create(:user, name: long_name, email: "#{'jane' * 100}@example.com")
      create(:group_admin, user: user, group: create(:group, name: long_house))

      described_class.perform_now(user.id)

      body = texted_body
      expect(body.length).to be <= NewSignupAlertJob::MAX_BODY_LENGTH
      expect(body).to include("email too long to text")
      expect(body).not_to include("<")
      expect(body).to include(long_name.first(12), long_house.first(12))
      expect(body).to end_with("Admins so far: 1.")
    end

    it "keeps every field readable rather than spending the whole message on the longest one" do
      stub_twilio_send
      user = create(:user, name: long_name, email: "a@b.co")
      create(:group_admin, user: user, group: create(:group, name: "The Beeches"))

      described_class.perform_now(user.id)

      expect(texted_body).to include("<a@b.co>", "House: The Beeches.")
    end
  end

  describe "when there is nobody to tell" do
    it "sends nothing at all with no operator number configured" do
      alert_phone(nil)
      stub_twilio_send
      user = create(:user)

      described_class.perform_now(user.id)

      expect(a_request(:post, TwilioStubs::MESSAGES_URL_PATTERN)).not_to have_been_made
    end

    # Signed up and gone again inside the minute this job waits.
    it "sends nothing for a user who no longer exists" do
      stub_twilio_send
      user = create(:user)
      id = user.id
      user.destroy!

      expect { described_class.perform_now(id) }.not_to raise_error
      expect(a_request(:post, TwilioStubs::MESSAGES_URL_PATTERN)).not_to have_been_made
    end
  end

  # An operator alert that cannot be delivered must never retry forever and must never take a queue
  # worker down with it. Both paths end the same way: reported once, and dropped.
  describe "a Twilio failure" do
    let(:user) { create(:user, name: "Jane Doe", email: "jane@example.com") }

    before { allow(Rails.error).to receive(:report) }

    it "does not raise, and does not retry, when the carrier refuses the message" do
      stub_twilio_error(status: 400, code: 21_211, message: "Invalid 'To' Phone Number")
      user

      expect { described_class.perform_now(user.id) }
        .not_to have_enqueued_job(described_class)

      expect(Rails.error).to have_received(:report).once.with(
        kind_of(Sms::PermanentFailure),
        hash_including(
          source: "rotamonster.sms",
          severity: :warning,
          context: { user_id: user.id, error_code: "21211" }
        )
      )
    end

    it "says so in the log, so a signup nobody was told about has an explanation" do
      allow(Rails.logger).to receive(:error).and_call_original
      stub_twilio_error(status: 400, code: 21_211)

      described_class.perform_now(user.id)

      expect(Rails.logger).to have_received(:error)
        .with(/NewSignupAlertJob\(#{user.id}\) was refused by the carrier/)
    end

    it "retries a wobble rather than dropping the alert" do
      stub_twilio_server_error
      user

      expect { described_class.perform_now(user.id) }
        .to have_enqueued_job(described_class).with(user.id)
    end

    # Reported once, at exhaustion, rather than once per attempt: one Twilio wobble must not page
    # anybody five times, and a wobble that heals is not news at all.
    it "reports once when the retries run out, with the carrier code" do
      stub_twilio_server_error
      user

      perform_enqueued_jobs { described_class.perform_later(user.id) }

      expect(a_request(:post, TwilioStubs::MESSAGES_URL_PATTERN)).to have_been_made.times(5)
      expect(Rails.error).to have_received(:report).once.with(
        kind_of(Sms::TransientFailure),
        hash_including(
          source: "rotamonster.sms",
          severity: :warning,
          context: { user_id: user.id, error_code: "500" }
        )
      )
    end

    it "reports nothing when a retry succeeds" do
      stub_request(:post, TwilioStubs::MESSAGES_URL_PATTERN).to_return(
        { status: 500, headers: { "Content-Type" => "application/json" }, body: { code: 20_500 }.to_json },
        { status: 201, headers: { "Content-Type" => "application/json" }, body: { sid: "SM1", status: "queued" }.to_json }
      )
      user

      perform_enqueued_jobs { described_class.perform_later(user.id) }

      expect(Rails.error).not_to have_received(:report)
    end
  end

  # Not a carrier problem: a bug on this path, or the database having a bad moment. The worst
  # outcome already available here is an operator not hearing about a signup, and raising would only
  # add a failed queue job to it.
  describe "an unexpected error" do
    let(:user) { create(:user, name: "Jane Doe", email: "jane@example.com") }

    before { allow(Rails.error).to receive(:report) }

    it "does not escape the job, and is reported once" do
      allow(Sms).to receive(:deliver).and_raise(RuntimeError, "something nobody planned for")
      user

      expect { described_class.perform_now(user.id) }.not_to raise_error

      expect(Rails.error).to have_received(:report).once.with(
        kind_of(RuntimeError),
        hash_including(
          source: "rotamonster.sms",
          severity: :warning,
          context: { user_id: user.id }
        )
      )
    end

    it "says so in the log too" do
      allow(Rails.logger).to receive(:error).and_call_original
      allow(Sms).to receive(:deliver).and_raise(RuntimeError, "something nobody planned for")

      described_class.perform_now(user.id)

      expect(Rails.logger).to have_received(:error)
        .with(/NewSignupAlertJob\(#{user.id}\) unexpected RuntimeError/)
    end
  end
end
