require "rails_helper"

# What a group is allowed to remember about where it came from. The value crosses a browser cookie
# and a JSON body before it arrives, so every example here is really asking the same question: can a
# caller put something in this jsonb column that nobody intended to be there?
RSpec.describe FirstTouch do
  describe ".sanitise" do
    it "keeps the five recognised keys" do
      result = described_class.sanitise(
        "utm_source" => "reddit", "utm_medium" => "social", "utm_campaign" => "flatshare",
        "utm_content" => "comment-1", "ref" => "member"
      )

      expect(result).to eq(
        "utm_source" => "reddit", "utm_medium" => "social", "utm_campaign" => "flatshare",
        "utm_content" => "comment-1", "ref" => "member"
      )
    end

    it "drops anything that is not one of the five" do
      expect(described_class.sanitise("utm_source" => "reddit", "gclid" => "x", "password" => "hunter2"))
        .to eq("utm_source" => "reddit")
    end

    it "accepts symbol keys, because a Ruby caller is a caller too" do
      expect(described_class.sanitise(utm_source: "reddit")).to eq("utm_source" => "reddit")
    end

    it "ignores values that are not strings, so no nested document can be smuggled in" do
      expect(described_class.sanitise("utm_source" => { "nested" => "object" }, "ref" => %w[a b]))
        .to be_nil
    end

    it "trims and caps a value rather than rejecting it" do
      long = "a" * 500

      expect(described_class.sanitise("utm_campaign" => "  spring  ", "utm_source" => long))
        .to eq("utm_campaign" => "spring", "utm_source" => "a" * FirstTouch::MAX_LENGTH)
    end

    it "returns nil rather than an empty hash when nothing survives" do
      expect(described_class.sanitise("utm_source" => "   ")).to be_nil
      expect(described_class.sanitise({})).to be_nil
      expect(described_class.sanitise(nil)).to be_nil
      expect(described_class.sanitise("not a hash")).to be_nil
    end

    it "reads ActionController::Parameters, which is what the controller actually holds" do
      params = ActionController::Parameters.new(utm_source: "reddit", ref: "member")
        .permit(*FirstTouch::KEYS)

      expect(described_class.sanitise(params)).to eq("utm_source" => "reddit", "ref" => "member")
    end
  end
end
