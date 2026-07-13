require "rails_helper"

RSpec.describe HeartbeatJob do
  it "enqueues on the default queue" do
    expect { described_class.perform_later("ping") }
      .to have_enqueued_job(described_class).with("ping").on_queue("default")
  end

  it "returns the token it was handed" do
    expect(described_class.perform_now("ping")).to eq("ping")
  end
end
