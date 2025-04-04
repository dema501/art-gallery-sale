import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { getAddress } from "viem";
import hre from "hardhat";

import {
  deployMarketplaceFixture,
  listedArtworkFixture,
  soldArtworkFixture,
} from "../fixtures/marketplace.fixture";
import { TEST_CONSTANTS } from "../constants";

describe("9. View Functions and Edge Cases", function () {
  const { ONE_ETHER } = TEST_CONSTANTS.PRICES;
  const { TEST_1: TEST_URI_1, TEST_2: TEST_URI_2 } = TEST_CONSTANTS.URI;
  const { NON_EXISTENT_ID: NON_EXISTENT_TOKEN_ID } = TEST_CONSTANTS.TOKENS;

  it("9.1 `getArtwork` should return correct details for existing listed/sold artwork", async function () {
    const listedData = await loadFixture(listedArtworkFixture);
    const soldData = await loadFixture(soldArtworkFixture);
    const {
      artGallery: artGalleryListed,
      artist1: artist1Listed,
      tokenId: tokenIdListed,
    } = listedData;
    const {
      artGallery: artGallerySold,
      artist1: artist1Sold,
      buyer1: buyer1Sold,
      tokenId: tokenIdSold,
    } = soldData;

    // Check listed artwork
    const [priceListed, isForSaleListed, artistListed] =
      await artGalleryListed.read.getArtwork([tokenIdListed]);
    expect(priceListed).to.equal(ONE_ETHER);
    expect(isForSaleListed).to.be.true;
    expect(artistListed).to.equal(getAddress(artist1Listed.account.address));

    // Check sold artwork
    const [priceSold, isForSaleSold, artistSold] =
      await artGallerySold.read.getArtwork([tokenIdSold]);
    expect(priceSold).to.equal(ONE_ETHER); // Price remains after sale
    expect(isForSaleSold).to.be.false; // Not for sale
    expect(artistSold).to.equal(getAddress(artist1Sold.account.address)); // Original artist
    expect(await artGallerySold.read.ownerOf([tokenIdSold])).to.equal(
      getAddress(buyer1Sold.account.address),
    ); // Current owner changed
  });

  it("9.2 `getArtwork` should revert for non-existent token", async function () {
    const { artGallery } = await loadFixture(deployMarketplaceFixture);
    await expect(
      artGallery.read.getArtwork([NON_EXISTENT_TOKEN_ID]),
    ).to.be.rejectedWith("ERC721NonexistentToken"); // Reverts due to internal ownerOf check
  });

  it("9.3 `isArtworkForSale` should return correct status (true/false) for existing tokens", async function () {
    const { artGallery, owner, publicClient, tokenId } =
      await loadFixture(listedArtworkFixture);
    expect(await artGallery.read.isArtworkForSale([tokenId])).to.be.true; // Initially true

    // Delist it
    const artGalleryAsOwner = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: owner } },
    );
    const tx = await artGalleryAsOwner.write.delistArtwork([tokenId]);
    await publicClient.waitForTransactionReceipt({ hash: tx });

    expect(await artGallery.read.isArtworkForSale([tokenId])).to.be.false; // False after delist
  });

  it("9.4 `isArtworkForSale` should return false for non-existent token", async function () {
    const { artGallery } = await loadFixture(deployMarketplaceFixture);
    // Does not revert, returns default mapping value (false)
    expect(await artGallery.read.isArtworkForSale([NON_EXISTENT_TOKEN_ID])).to
      .be.false;
  });

  it("9.5 `getPrice` should return correct price for existing tokens", async function () {
    const { artGallery, tokenId } = await loadFixture(listedArtworkFixture);
    expect(await artGallery.read.getPrice([tokenId])).to.equal(ONE_ETHER);
  });

  it("9.6 `getPrice` should return zero for non-existent token", async function () {
    const { artGallery } = await loadFixture(deployMarketplaceFixture);
    // Does not revert, returns default mapping value (0)
    expect(await artGallery.read.getPrice([NON_EXISTENT_TOKEN_ID])).to.equal(
      0n,
    );
  });

  it("9.7 `getTotalArtworks` should reflect the number of minted tokens", async function () {
    const { artGallery, artist1, publicClient } = await loadFixture(
      deployMarketplaceFixture,
    );
    expect(await artGallery.read.getTotalArtworks()).to.equal(0n);

    const artGalleryAsArtist = await hre.viem.getContractAt(
      "ArtGalleryMarketplace",
      artGallery.address,
      { client: { wallet: artist1 } },
    );

    // List first
    const tx1 = await artGalleryAsArtist.write.listArtwork([
      TEST_URI_1,
      ONE_ETHER,
    ]);
    await publicClient.waitForTransactionReceipt({ hash: tx1 });
    expect(await artGallery.read.getTotalArtworks()).to.equal(1n);

    // List second
    const tx2 = await artGalleryAsArtist.write.listArtwork([
      TEST_URI_2,
      ONE_ETHER,
    ]);
    await publicClient.waitForTransactionReceipt({ hash: tx2 });
    expect(await artGallery.read.getTotalArtworks()).to.equal(2n);
  });

  it("9.8 `tokenURI` should return correct URI for existing token", async function () {
    const { artGallery, tokenId } = await loadFixture(listedArtworkFixture);
    expect(await artGallery.read.tokenURI([tokenId])).to.equal(TEST_URI_1);
  });

  it("9.9 `tokenURI` should revert for non-existent token", async function () {
    const { artGallery } = await loadFixture(deployMarketplaceFixture);
    await expect(
      artGallery.read.tokenURI([NON_EXISTENT_TOKEN_ID]),
    ).to.be.rejectedWith("ERC721NonexistentToken");
  });
});
