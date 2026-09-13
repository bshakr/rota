require "rails_helper"

# Granting god mode is a deploy, not a click, so the whole grant is one environment variable and
# the rules for reading it are these. They are safety-critical and trivially testable, so they live
# in SuperAdminAllowlist (defined in config/initializers/super_admin.rb) rather than inline in the
# config block — the same shape as SmsBoot.
RSpec.describe SuperAdminAllowlist do
  describe ".parse" do
    it "reads a comma-separated list" do
      expect(described_class.parse("user_01ALICE,user_01BOB")).to eq(Set["user_01ALICE", "user_01BOB"])
    end

    # Deploy platforms and copy-paste both add whitespace, and an id with a stray space is an
    # operator who cannot get in and has no idea why.
    it "trims whitespace and newlines around the ids" do
      expect(described_class.parse("  user_01ALICE ,\n user_01BOB  \n")).to eq(Set["user_01ALICE", "user_01BOB"])
    end

    it "ignores empty entries from a trailing or doubled comma" do
      expect(described_class.parse("user_01ALICE,,user_01BOB,")).to eq(Set["user_01ALICE", "user_01BOB"])
    end

    it "treats an unset or empty variable as nobody" do
      expect(described_class.parse(nil)).to be_empty
      expect(described_class.parse("")).to be_empty
      expect(described_class.parse("   ")).to be_empty
    end

    # Parsed once at boot and then read on every super admin request, so nothing may mutate it
    # afterwards — the allowlist cannot be widened at runtime, by this app or anything in it.
    it "returns a frozen set" do
      expect(described_class.parse("user_01ALICE")).to be_frozen
    end
  end

  describe ".allows?" do
    before { Rails.application.config.x.super_admin.allowlist = Set["user_01ALICE"].freeze }

    it "is true for an id on the list" do
      expect(described_class.allows?("user_01ALICE")).to be(true)
    end

    it "is false for an id that is not" do
      expect(described_class.allows?("user_01BOB")).to be(false)
    end

    # Fails closed. A blank sub is a token we should never have believed, and it must not be able
    # to match a blank entry that parsing should have removed.
    it "is false for nil or blank" do
      expect(described_class.allows?(nil)).to be(false)
      expect(described_class.allows?("")).to be(false)
    end

    it "is false for everyone when the list is empty" do
      Rails.application.config.x.super_admin.allowlist = Set.new.freeze

      expect(described_class.allows?("user_01ALICE")).to be(false)
    end

    # A misconfigured boot must not hand out access. There is no path that leaves this unset, but
    # "no list" has exactly one safe reading.
    it "is false when the allowlist was never resolved at all" do
      Rails.application.config.x.super_admin.allowlist = nil

      expect(described_class.allows?("user_01ALICE")).to be(false)
    end
  end

  # What actually booted this test run: proof the wiring resolves, not just the rules.
  describe "the resolved configuration" do
    it "is a frozen set" do
      expect(Rails.application.config.x.super_admin.allowlist).to be_a(Set).and be_frozen
    end
  end
end
