require "rails_helper"

# The walk both the nightly job and the one-off rake task run. What is tested here is everything
# that is true of the walk itself rather than of either caller: how it reads a 404, what it does
# with a currency it did not expect, and the one connection it holds while it works.
RSpec.describe Sms::PriceBackfill do
  def sent_message(sid:, created_at: 1.day.ago, **attributes)
    create(:sms_message, :sent, twilio_sid: sid, created_at: created_at, **attributes)
  end

  # The most expensive mistake this class can make, and the reason the two cases are not one.
  # Twilio puts the Account SID in the request path, so the wrong credential 404s every message the
  # real account owns — identical, row by row, to a history Twilio has genuinely forgotten.
  describe "a 404 from Twilio" do
    it "is terminal for a message older than Twilio's retention horizon" do
      forgotten = sent_message(sid: "SM00000000000000000000000000000001", created_at: 400.days.ago)
      stub_twilio_fetch_missing(sid: forgotten.twilio_sid)

      outcome = described_class.new.call

      expect(outcome.aged_out).to eq(1)
      expect(forgotten.reload).to have_attributes(price: nil, price_fetched_at: be_present)
    end

    # A message from last week is one Twilio should know about. Marking it asked would spend the
    # single chance to recover its price on what is far more likely to be a misconfigured account.
    it "leaves a recent message exactly as it was, and counts it" do
      recent = sent_message(sid: "SM00000000000000000000000000000002", created_at: 3.days.ago)
      stub_twilio_fetch_missing(sid: recent.twilio_sid)

      outcome = described_class.new.call

      expect(outcome.unmatched).to eq(1)
      expect(outcome.aged_out).to be_zero
      expect(recent.reload).to have_attributes(price: nil, price_unit: nil, price_fetched_at: nil)
    end

    it "logs the row it could not match, because nothing on the row itself will record it" do
      recent = sent_message(sid: "SM00000000000000000000000000000003", created_at: 3.days.ago)
      stub_twilio_fetch_missing(sid: recent.twilio_sid)
      allow(Rails.logger).to receive(:warn)

      described_class.new.call

      expect(Rails.logger).to have_received(:warn).with(/does not recognise SM00000000000000000000000000000003/)
    end

    # Row after row of 404s from the very first one is the shape a wrong Account SID makes. Stopping
    # caps what a misconfigured run can write off at the threshold, rather than the whole table.
    it "stops the walk when nothing but 404s comes back" do
      stub_const("Sms::PriceBackfill::NOT_FOUND_ABORT_THRESHOLD", 3)
      messages = 4.times.map do |n|
        sent_message(sid: format("SM%032d", 100 + n), created_at: (400 - n).days.ago)
      end
      messages.each { |message| stub_twilio_fetch_missing(sid: message.twilio_sid) }

      outcome = described_class.new.call

      expect(outcome.halted).to match(/TWILIO_ACCOUNT_SID/)
      expect(outcome.aged_out).to eq(3)
      expect(a_request(:get, twilio_message_url(messages.last.twilio_sid))).not_to have_been_made
    end

    it "does not stop over scattered 404s once Twilio has answered properly at least once" do
      stub_const("Sms::PriceBackfill::NOT_FOUND_ABORT_THRESHOLD", 2)
      priced = sent_message(sid: "SM00000000000000000000000000000201", created_at: 400.days.ago)
      first_gone = sent_message(sid: "SM00000000000000000000000000000202", created_at: 399.days.ago)
      second_gone = sent_message(sid: "SM00000000000000000000000000000203", created_at: 398.days.ago)
      stub_twilio_fetch(sid: priced.twilio_sid)
      [ first_gone, second_gone ].each { |message| stub_twilio_fetch_missing(sid: message.twilio_sid) }

      outcome = described_class.new.call

      expect(outcome.halted).to be_nil
      expect(outcome).to have_attributes(priced: 1, aged_out: 2)
    end
  end

  describe "the currency Twilio billed in" do
    # Twilio bills a UK number in GBP and a US one in USD. Storing what it reports is right; adding
    # the two together on a spend page would not be, so the day it first happens has to be findable.
    it "warns when the charge is not in USD, and stores it as reported anyway" do
      message = sent_message(sid: "SM00000000000000000000000000000004")
      stub_twilio_fetch(sid: message.twilio_sid, price: "-0.04000", price_unit: "GBP")
      allow(Rails.logger).to receive(:warn)

      described_class.new.call

      expect(message.reload).to have_attributes(price: BigDecimal("0.04"), price_unit: "GBP")
      expect(Rails.logger).to have_received(:warn).with(/billed in GBP, not USD/)
    end

    it "stores the amount with no unit when Twilio reported none" do
      message = sent_message(sid: "SM00000000000000000000000000000005")
      stub_twilio_fetch(sid: message.twilio_sid, price: "-0.00790", price_unit: nil)

      described_class.new.call

      expect(message.reload).to have_attributes(price: BigDecimal("0.0079"), price_unit: nil, price_fetched_at: be_present)
    end

    it "says nothing about a plain USD charge" do
      message = sent_message(sid: "SM00000000000000000000000000000006")
      stub_twilio_fetch(sid: message.twilio_sid, price_unit: "USD")
      allow(Rails.logger).to receive(:warn)

      described_class.new.call

      expect(Rails.logger).not_to have_received(:warn)
    end
  end

  # One adapter, and inside it one Twilio client: across a thirteen-month history that is the
  # difference between a single connection and a TLS handshake per message.
  it "holds one adapter for the whole walk" do
    two_rows = [ "SM00000000000000000000000000000007", "SM00000000000000000000000000000008" ]
    two_rows.each_with_index do |sid, index|
      sent_message(sid: sid, created_at: (index + 1).days.ago)
      stub_twilio_fetch(sid: sid)
    end
    allow(Sms).to receive(:adapter).and_call_original

    backfill = described_class.new
    backfill.call

    expect(Sms).to have_received(:adapter).once
  end
end
