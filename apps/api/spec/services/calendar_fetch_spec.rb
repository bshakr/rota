require "rails_helper"

RSpec.describe CalendarFetch do
  let(:url) { "https://calendar.google.com/calendar/ical/x/private-abc/basic.ics" }
  let(:ics) { "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n" }

  it "returns the body and caching headers" do
    stub_request(:get, url).to_return(status: 200, body: ics, headers: { "ETag" => "\"v1\"", "Last-Modified" => "Sun, 13 Sep 2026 10:00:00 GMT" })

    result = described_class.call(url)

    expect(result.status).to eq(:ok)
    expect(result.body).to eq(ics)
    expect(result.etag).to eq("\"v1\"")
    expect(result.last_modified).to eq("Sun, 13 Sep 2026 10:00:00 GMT")
  end

  it "sends conditional headers and reports not modified" do
    stub_request(:get, url).with(headers: { "If-None-Match" => "\"v1\"", "If-Modified-Since" => "Sun, 13 Sep 2026 10:00:00 GMT" }).to_return(status: 304)

    result = described_class.call(url, etag: "\"v1\"", last_modified: "Sun, 13 Sep 2026 10:00:00 GMT")

    expect(result.status).to eq(:not_modified)
    expect(result.body).to be_nil
  end

  it "refuses non-https links without a request" do
    expect { described_class.call("http://calendar.google.com/x.ics") }.to raise_error(described_class::InvalidUrl)
    expect { described_class.call("not a url") }.to raise_error(described_class::InvalidUrl)
    expect(a_request(:get, /.*/)).not_to have_been_made
  end

  it "raises Gone for a reset link" do
    stub_request(:get, url).to_return(status: 404)

    expect { described_class.call(url) }.to raise_error(described_class::Gone)
  end

  it "raises Unreachable on server errors and timeouts, without the url in the message" do
    stub_request(:get, url).to_return(status: 503)
    expect { described_class.call(url) }.to raise_error(described_class::Unreachable) { |e| expect(e.message).not_to include("private-abc") }

    stub_request(:get, url).to_timeout
    expect { described_class.call(url) }.to raise_error(described_class::Unreachable)
  end

  it "follows one https redirect and refuses an http one" do
    stub_request(:get, url).to_return(status: 302, headers: { "Location" => "https://calendar.google.com/moved.ics" })
    stub_request(:get, "https://calendar.google.com/moved.ics").to_return(status: 200, body: ics)
    expect(described_class.call(url).body).to eq(ics)

    stub_request(:get, url).to_return(status: 302, headers: { "Location" => "http://calendar.google.com/moved.ics" })
    expect { described_class.call(url) }.to raise_error(described_class::Unreachable)
  end

  it "raises Unreachable when a redirect points somewhere unparsable" do
    stub_request(:get, url).to_return(status: 302, headers: { "Location" => "http://[nonsense" })

    expect { described_class.call(url) }.to raise_error(described_class::Unreachable) { |e| expect(e.message).not_to include("nonsense") }
  end

  it "aborts past the byte cap" do
    stub_request(:get, url).to_return(status: 200, body: "X" * (described_class::MAX_BYTES + 1))

    expect { described_class.call(url) }.to raise_error(described_class::TooLarge)
  end
end
