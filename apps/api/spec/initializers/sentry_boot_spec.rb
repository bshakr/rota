require "rails_helper"

# The boot guard that stops production running unreported. It is the same argument SmsBoot makes
# about a silent SMS path: a misconfigured reporter fails silently, and the first symptom of a
# silent reporter is a house that quietly stopped being texted. The rule is extracted into
# SentryBoot (defined in config/initializers/sentry.rb) so it can be asserted without booting a
# production environment.
RSpec.describe SentryBoot do
  def env(name)
    ActiveSupport::StringInquirer.new(name)
  end

  describe ".dsn_for" do
    it "returns the DSN whenever one is set" do
      expect(described_class.dsn_for(env: env("production"), value: "https://key@example.ingest.sentry.io/1"))
        .to eq("https://key@example.ingest.sentry.io/1")
      expect(described_class.dsn_for(env: env("development"), value: "https://key@example.ingest.sentry.io/1"))
        .to eq("https://key@example.ingest.sentry.io/1")
    end

    it "refuses to boot production without one" do
      expect { described_class.dsn_for(env: env("production"), value: nil) }
        .to raise_error(/SENTRY_DSN must be set in production/)
      expect { described_class.dsn_for(env: env("production"), value: "") }
        .to raise_error(/SENTRY_DSN must be set in production/)
    end

    it "disables the SDK everywhere else, so development and the suite need no account" do
      expect(described_class.dsn_for(env: env("development"), value: nil)).to be_nil
      expect(described_class.dsn_for(env: env("test"), value: nil)).to be_nil
    end
  end

  # What actually booted this test run: proof the wiring resolves, not just the rules. In
  # particular that the suite is running with the SDK initialised (so Sentry::TestHelper works) and
  # sending nothing (so no spec can reach sentry.io).
  describe "the resolved test configuration" do
    it "is initialised but not enabled in test" do
      expect(Sentry.initialized?).to be(true)
      expect(Sentry.configuration.dsn).to be_nil
      expect(Sentry.configuration.enabled_environments).to eq(%w[ production preview ])
    end

    it "collects none of the data a member's token or number could ride in" do
      dc = Sentry.configuration.data_collection

      expect(dc.user_info).to be(false)
      expect(dc.cookies.mode).to eq(:off)
      expect(dc.http_bodies).to eq([])
      expect(dc.url_query_params.mode).to eq(:off)
      expect(dc.database_query_data).to be(false)
      expect(dc.collect_stack_frame_variables?).to be(false)
      expect(dc.http_headers.request.mode).to eq(:deny_list)
      expect(dc.http_headers.request.terms).to include("authorization", "cookie", "x-twilio-signature")
    end

    it "subscribes to Rails.error, which is what the jobs' report calls depend on" do
      expect(Sentry.configuration.rails.register_error_subscriber).to be(true)
      expect(Sentry.configuration.rails.active_job_report_on_retry_error).to be(false)
    end
  end
end
