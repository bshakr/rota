# One request to a paid model, written by whoever made it, for the super admin spend page. The
# tokens are the truth: they are stored exactly as the model reported them and survive any later
# change to what a token costs. `cost_usd` is a snapshot taken at write time from the rate table in
# config/initializers/calendar_classifier.rb, so editing a rate reprices what comes next and never
# moves a quarter that has already been read.
#
# Failures are recorded too. A 429 or a reply in the wrong shape still costs the input tokens once
# Anthropic accepted the request, and a house whose calendar never manages to classify is a house
# that keeps paying for nothing.
class AiCall < ApplicationRecord
  # The token columns, which are also the keys of the rate table: one set of names for both, so a
  # rate can never end up priced against the wrong count.
  TOKEN_COLUMNS = %i[
    input_tokens output_tokens cache_creation_input_tokens cache_read_input_tokens
  ].freeze
  # Rates are quoted the way Anthropic quotes them, in dollars per million tokens.
  PER_MILLION = 1_000_000
  # Matches the column, decimal(12, 6). Rounding here rather than leaving it to Postgres keeps the
  # value the same whether it has been through the database or not.
  CENTS_PRECISION = 6

  belongs_to :group
  # Nullable: the connection that spent this can be replaced or removed, and the spend stays.
  belongs_to :calendar_connection, optional: true

  validates :purpose, :model, presence: true

  scope :succeeded, -> { where(succeeded: true) }
  scope :failed, -> { where(succeeded: false) }

  # The four token counts, from anything that answers to them: the SDK's own usage object, or a
  # stand-in in a spec. A field the reply left out (Anthropic omits the cache counts when nothing
  # was cached) reads as zero, because "no tokens" is what a missing count means and nil would make
  # the arithmetic below give up on the whole call.
  def self.tokens_from(usage)
    TOKEN_COLUMNS.index_with do |column|
      usage.respond_to?(column) ? usage.public_send(column).to_i : 0
    end
  end

  # Dollars for one call, or nil when the model is not priced. Deliberately never raises: this runs
  # inside a request that has already been paid for, and a model id we do not recognise is a reason
  # to leave the cost blank and keep the tokens, not to fail a house's calendar sync.
  def self.cost_usd_for(model, tokens)
    rates = Rails.configuration.x.calendar_classifier.rates[model]
    if rates.nil?
      Rails.logger.warn("AiCall has no rate for model #{model}; storing tokens with no cost")
      return nil
    end

    total = TOKEN_COLUMNS.sum { |column| rates.fetch(column) * tokens.fetch(column, 0) }
    (total / PER_MILLION).round(CENTS_PRECISION)
  end
end
