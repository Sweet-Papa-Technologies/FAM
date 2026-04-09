class Fam < Formula
  desc "FoFo Agent Manager — One config. Every agent."
  homepage "https://github.com/Sweet-Papa-Technologies/FAM"
  # NOTE: Update the version and URL below when publishing a new release.
  # The sha256 must be filled after running `npm publish`.
  url "https://registry.npmjs.org/@sweetpapatech/fam/-/fam-#{version}.tgz"
  # sha256 will be filled after npm publish
  license "MIT"
  depends_on "node@22"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/fam --version")
  end
end
