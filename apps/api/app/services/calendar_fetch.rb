require "net/http"

# Fetches a calendar feed and nothing more. Net::HTTP with explicit timeouts, the same idiom as the
# WorkOS JWKS fetch (app/lib/workos_access_token.rb). Every error is one of the classes below and
# none carries the link in its message: the link is a credential and these messages end up in logs
# and on the admin dashboard.
class CalendarFetch
  class Error < StandardError; end
  class InvalidUrl < Error; end
  class Gone < Error; end
  class Unreachable < Error; end
  class TooLarge < Error; end

  Result = Struct.new(:status, :body, :etag, :last_modified, keyword_init: true)

  OPEN_TIMEOUT = 5
  READ_TIMEOUT = 15
  MAX_BYTES = 5 * 1024 * 1024
  MAX_REDIRECTS = 2
  GONE_STATUSES = %w[401 403 404 410].freeze

  def self.call(url, etag: nil, last_modified: nil)
    new(url, etag: etag, last_modified: last_modified).call
  end

  def initialize(url, etag:, last_modified:)
    @uri = parse(url)
    @etag = etag
    @last_modified = last_modified
  end

  def call
    fetch(@uri, redirects_left: MAX_REDIRECTS)
  # URI::InvalidURIError belongs here with the network failures: it is what a Location header full
  # of junk raises, and letting it escape would both break the promise that every failure is a
  # CalendarFetch::Error and put a string the remote server chose into our logs.
  rescue Timeout::Error, SocketError, Errno::ECONNREFUSED, Errno::ECONNRESET, Errno::EHOSTUNREACH,
         OpenSSL::SSL::SSLError, Net::HTTPBadResponse, Net::ProtocolError, URI::InvalidURIError,
         IOError => e
    raise Unreachable, "#{e.class.name.demodulize} while fetching the calendar"
  end

  private

  def parse(url)
    uri = URI.parse(url.to_s.strip)
    raise InvalidUrl, "calendar links must be https" unless uri.is_a?(URI::HTTPS) && uri.host.present?

    uri
  rescue URI::InvalidURIError
    raise InvalidUrl, "not a valid link"
  end

  def fetch(uri, redirects_left:)
    request = Net::HTTP::Get.new(uri)
    request["Accept"] = "text/calendar, */*;q=0.5"
    request["User-Agent"] = "RotaMonster/1.0 (+https://rota.monster)"
    request["If-None-Match"] = @etag if @etag.present?
    request["If-Modified-Since"] = @last_modified if @last_modified.present?

    Net::HTTP.start(uri.host, uri.port, use_ssl: true, open_timeout: OPEN_TIMEOUT, read_timeout: READ_TIMEOUT) do |http|
      http.request(request) do |response|
        case response
        when Net::HTTPNotModified
          return Result.new(status: :not_modified)
        when Net::HTTPRedirection
          raise Unreachable, "too many redirects" if redirects_left.zero?

          location = URI.join(uri, response["Location"].to_s)
          raise Unreachable, "redirected off https" unless location.is_a?(URI::HTTPS)

          return fetch(location, redirects_left: redirects_left - 1)
        when Net::HTTPSuccess
          return Result.new(status: :ok, body: read_capped(response), etag: response["ETag"], last_modified: response["Last-Modified"])
        else
          raise Gone, "calendar responded #{response.code}" if GONE_STATUSES.include?(response.code)

          raise Unreachable, "calendar responded #{response.code}"
        end
      end
    end
  end

  # Stream the body so a wrong link pointing at something huge is abandoned early rather than read.
  def read_capped(response)
    body = +""
    response.read_body do |chunk|
      body << chunk
      raise TooLarge, "calendar feed exceeds #{MAX_BYTES} bytes" if body.bytesize > MAX_BYTES
    end
    body.force_encoding(Encoding::UTF_8)
  end
end
