require "rails_helper"

RSpec.describe ApplicationMailer do
  it "sends from the bloombase.studio address" do
    expect(described_class.default[:from]).to eq("hello@bloombase.studio")
  end
end
