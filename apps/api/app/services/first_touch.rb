# Where a house came from, reduced to five strings.
#
# The web app writes these into an httpOnly cookie the first time a browser lands on `/`, and hands
# them over once, when the house is named. By then the value has crossed a cookie and a JSON body,
# so it arrives as whatever the client sent: this is the one place that decides what a first touch
# is allowed to be before it is stored on a group.
#
# The rules are deliberately blunt. Only these five keys, only strings, trimmed, capped, and blanks
# dropped — a campaign name is a label on a chart, never a payload, and a jsonb column with no shape
# is a column that eventually holds someone's entire query string.
module FirstTouch
  # The four UTM parameters plus `ref`, which is what the member feed's "start one for your house"
  # link carries. Anything else on the query string is ignored.
  KEYS = %w[utm_source utm_medium utm_campaign utm_content ref].freeze

  # Long enough for any real campaign name, short enough that the column can never be used as
  # storage. Values are truncated rather than rejected: a mangled label still beats losing the row.
  MAX_LENGTH = 200

  module_function

  # Returns a hash of the recognised keys, or nil when nothing survives. Nil is meaningful: it is
  # what "arrived with no campaign at all" looks like, and it keeps the column NULL rather than {}.
  def sanitise(raw)
    hash = to_hash(raw)
    return nil if hash.nil?

    cleaned = KEYS.each_with_object({}) do |key, out|
      value = hash[key] || hash[key.to_sym]
      next unless value.is_a?(String)

      trimmed = value.strip[0, MAX_LENGTH].to_s
      out[key] = trimmed unless trimmed.empty?
    end

    cleaned.empty? ? nil : cleaned
  end

  def to_hash(raw)
    return raw.to_unsafe_h if raw.respond_to?(:to_unsafe_h)
    return raw if raw.is_a?(Hash)

    nil
  end
end
