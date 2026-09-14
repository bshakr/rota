require "rails_helper"

# The boot guards are the code that stops production from silently texting nobody, or booting
# half-configured. Safety-critical code with no test is exactly what bites at launch, so the rules
# are extracted into SmsBoot (defined in config/initializers/sms.rb) and asserted here.
RSpec.describe SmsBoot do
  def env(name)
    ActiveSupport::StringInquirer.new(name)
  end

  describe ".adapter_for" do
    it "defaults development to the null adapter, so a dev run cannot text anybody" do
      expect(described_class.adapter_for(env: env("development"), requested: nil)).to eq("null")
    end

    it "defaults test and production to the real Twilio adapter" do
      expect(described_class.adapter_for(env: env("test"), requested: nil)).to eq("twilio")
      expect(described_class.adapter_for(env: env("production"), requested: nil)).to eq("twilio")
    end

    it "honours an explicit SMS_ADAPTER override" do
      expect(described_class.adapter_for(env: env("development"), requested: "twilio")).to eq("twilio")
    end

    it "refuses to boot production with the null adapter" do
      expect { described_class.adapter_for(env: env("production"), requested: "null") }
        .to raise_error(/SMS_ADAPTER=null in production/)
    end
  end

  describe ".require_in_production" do
    it "returns the value when it is present" do
      expect(described_class.require_in_production("APP_URL", "https://x.example", env: env("production")))
        .to eq("https://x.example")
    end

    it "raises in production when the value is missing" do
      expect { described_class.require_in_production("APP_URL", nil, env: env("production")) }
        .to raise_error(/APP_URL must be set in production/)
      expect { described_class.require_in_production("APP_URL", "", env: env("production")) }
        .to raise_error(/APP_URL must be set in production/)
    end

    it "falls back to the development default outside production" do
      expect(described_class.require_in_production("APP_URL", nil, env: env("development"))).to be_nil
      expect(described_class.require_in_production("APP_URL", nil, env: env("test"))).to be_nil
    end
  end

  # SIGNUP_ALERT_PHONE, the operator's number for NewSignupAlertJob. Optional everywhere, and a
  # value that is set must be dialable at boot rather than at the first signup. An alert that never
  # arrives says nothing about why.
  describe ".signup_alert_phone_for" do
    it "means nobody when it is unset, which is a supported state and not a broken one" do
      expect(described_class.signup_alert_phone_for(nil)).to be_nil
      expect(described_class.signup_alert_phone_for("   ")).to be_nil
    end

    # An operator types the number the way they would dial it at home. libphonenumber calls that
    # national form invalid and the identical number in E.164 valid, so it is normalised first and
    # judged afterwards, the same order Member#normalise_phone uses.
    it "normalises a number typed in national form to E.164" do
      expect(described_class.signup_alert_phone_for("07911 123456")).to eq("+447911123456")
    end

    it "leaves a number already in international form alone" do
      expect(described_class.signup_alert_phone_for("+44 7911 123456")).to eq("+447911123456")
    end

    it "refuses to boot on something it could not dial" do
      expect { described_class.signup_alert_phone_for("not a phone number") }
        .to raise_error(/SIGNUP_ALERT_PHONE is not a phone number/)
      expect { described_class.signup_alert_phone_for("07911") }
        .to raise_error(/SIGNUP_ALERT_PHONE is not a phone number/)
    end
  end

  # What actually booted this test run: proof the wiring resolves, not just the rules.
  describe "the resolved test configuration" do
    it "runs the real Twilio adapter and reads APP_URL into the magic-link base" do
      expect(Rails.configuration.x.sms.adapter).to eq("twilio")
      expect(Rails.configuration.x.sms.app_url).to be_present
    end

    # The default the rest of the suite depends on: with no operator number, creating a user texts
    # nobody and enqueues nothing at all.
    it "has no signup alert number, because the suite does not set one" do
      expect(Rails.configuration.x.sms.signup_alert_phone).to be_nil
    end
  end
end
