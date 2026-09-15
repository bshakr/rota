require "rails_helper"

# The one question this table answers — "has this browser been here yet today?" — and the two
# promises the privacy page makes about it: a code is unusable the moment the day turns, and it is
# deleted soon afterwards.
RSpec.describe DailyVisitor do
  # Sixty-four characters of hex, as the web app sends them. Distinct per letter so two codes in one
  # example are obviously two codes.
  def code(letter = "a")
    letter * 64
  end

  # A Tuesday at noon UTC, so "today" and "yesterday" are unambiguous and nothing here depends on
  # the day the suite happens to run on.
  let(:now) { Time.utc(2026, 9, 15, 12, 0, 0) }

  around { |example| travel_to(now) { example.run } }

  describe ".claim" do
    it "is true the first time a code is seen today, and false afterwards" do
      expect(described_class.claim(code)).to be(true)
      expect(described_class.claim(code)).to be(false)
      expect(described_class.claim(code)).to be(false)

      expect(described_class.count).to eq(1)
    end

    it "is true for a second code on the same day" do
      expect(described_class.claim(code("a"))).to be(true)
      expect(described_class.claim(code("b"))).to be(true)

      expect(described_class.count).to eq(2)
    end

    # The same browser tomorrow is a new visitor, which is the honest answer rather than a
    # limitation: the code it sends tomorrow is not this one, because the salt has changed, and
    # nothing here could recognise it if it were.
    it "is true again for the same code on the next day" do
      described_class.claim(code)

      expect(described_class.claim(code, day: now.to_date + 1)).to be(true)
      expect(described_class.pluck(:day)).to contain_exactly(now.to_date, now.to_date + 1)
    end

    # Anything that did not come out of the web app's hash. The visit is still counted; it is
    # counted without a visitor, which is the same state every visit was in before this shipped.
    it "ignores a code that is not sixty-four characters of lowercase hex" do
      [
        nil, "", "not-a-digest", code[0, 63], "#{code}a", code.upcase, "g" * 64, 123,
        "#{code[0, 63]}\n"
      ].each do |bad|
        expect(described_class.claim(bad)).to be_nil, bad.inspect
      end

      expect(described_class.count).to be_zero
    end

    # Two beacons from one page load, or a double tap. The unique index decides, not a read
    # followed by a write, so exactly one of them can ever be told "first".
    it "hands the claim to exactly one of two racing callers" do
      results = Array.new(2) { described_class.claim(code) }

      expect(results).to contain_exactly(true, false)
      expect(described_class.count).to eq(1)
    end
  end

  describe ".prune" do
    it "keeps today and yesterday, and deletes everything older" do
      described_class.create!(day: now.to_date, digest: code("a"))
      described_class.create!(day: now.to_date - 1, digest: code("b"))
      described_class.create!(day: now.to_date - 2, digest: code("c"))
      described_class.create!(day: now.to_date - 30, digest: code("d"))

      expect(described_class.prune).to eq(2)
      expect(described_class.pluck(:day)).to contain_exactly(now.to_date, now.to_date - 1)
    end

    it "deletes nothing when everything is current" do
      described_class.claim(code)

      expect(described_class.prune).to be_zero
      expect(described_class.count).to eq(1)
    end

    # The salt these codes were made with is keyed on the UTC date, so UTC is the only calendar a
    # row here has. A pruner reading a local date would delete a day early or a day late in half the
    # world.
    it "reads the day in UTC whatever the caller's clock says" do
      described_class.create!(day: now.to_date - 2, digest: code("c"))

      expect(described_class.prune(now: Time.utc(2026, 9, 15, 23, 30, 0).in_time_zone("Australia/Sydney")))
        .to eq(1)
    end
  end

  # The privacy page tells a visitor this code is deleted, and the only thing that makes that true
  # is the schedule entry. `analytics:prune` had none before today and was documented as "run it by
  # hand", which is a fine way to keep a table small and no way at all to keep a promise. Guarded
  # here the way the reminder sweep and the job-run prune guard theirs.
  describe "recurring schedule" do
    let(:config) { YAML.load_file(Rails.root.join("config/recurring.yml"), aliases: true) }

    it "is pruned daily in production" do
      entry = config.dig("production", "prune_analytics")

      expect(entry["command"]).to include("DailyVisitor.prune")
      expect(entry["schedule"]).to match(/every day/)
    end
  end
end
