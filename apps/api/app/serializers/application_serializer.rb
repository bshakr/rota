# The API returns hand-written hashes rather than a rendering library: the shapes are few, the web
# app builds TypeScript types off them, and a plain Ruby hash is the least surprising contract to
# read. Each serializer describes exactly one resource; `one` and `many` are the only two ways a
# controller reaches them, and `one(nil)` is null so an optional association serializes without a
# guard at the call site.
class ApplicationSerializer
  def self.one(record)
    record && new(record).as_json
  end

  def self.many(records)
    records.map { |record| new(record).as_json }
  end

  def initialize(record)
    @record = record
  end

  private

  attr_reader :record
end
