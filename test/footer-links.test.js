import test from 'node:test'
import assert from 'node:assert/strict'
import { footerLinkGroups } from '../src/footerLinks.js'

test('footer links use real destinations for every requested label', () => {
  const links = new Map(footerLinkGroups.flatMap((group) => group.links.map((link) => [link.label, link.href])))

  assert.equal(links.get('All Products'), '/categories')
  assert.equal(links.get('Furniture'), '/categories?category=furniture')
  assert.equal(links.get('Home Decor'), '/categories?category=home-decoration')
  assert.equal(links.get('About Us'), '/about')
  assert.equal(links.get('Sustainability'), '/about#sustainability')
  assert.equal(links.get('Sell on Buyamia'), '/sell-on-buyamia')
  assert.equal(links.get('Help Center'), '/support')
  assert.equal(links.get('Contact Us'), '/support#contact')
  assert.equal(links.get('FAQ'), '/support#faq')

  for (const href of links.values()) assert.notEqual(href, '#')
})
