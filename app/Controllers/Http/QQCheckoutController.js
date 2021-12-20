'use strict'

const logger       = use('App/Services/Logger')
const Config       = use('Config')
const Database     = use('Database')
const moment       = use('moment')
const randomString = use('randomstring')
const queryString  = use('querystring')
const crypto       = use('crypto')
const convert      = use('xml-js')
const axios        = use('axios')

class QQCheckoutController {
  /**
   * 签名。
   *
   * @param  {Object} data 参与签名的数据。
   * @param  {string} key 密钥。
   * @return {string} 返回签名。
   */
  paySign (data, key) {
    /** 1. 排序。 */
    const sortedOrder = Object.keys(data).sort().reduce((accumulator, key) => {
      accumulator[key] = data[key]
      // logger.debug(accumulator)
      return accumulator
    }, {})

    /** 2. 转换成地址查询符。 */
    const stringOrder = queryString.stringify(sortedOrder, null, null, {
      encodeURIComponent: queryString.unescape
    })

    /** 3. 结尾加上密钥。 */
    const stringOrderWithKey = `${ stringOrder }&key=${ key }`

    /** 4. md5 后全部大写。 */
    const sign = crypto.createHash('md5').update(stringOrderWithKey).digest('hex').toUpperCase()

    /**
     * 返回签名数据。
     */
    return sign
  }

  /**
   * object 转换为 xml 格式的数据。
   *
   * @param  {Object} order 要转换成 xml 格式的对象。
   * @param  {string} sign  按规定算出来的签名。
   * @return 转换成 xml 格式的数据。
   */
  orderToXML (order, sign) {
    /**
     * 构建需要转换的 object
     */
    order = {
      xml: {
        ...order,
        sign
      }
    }

    /**
     * 将 object 转换成 xml
     */
    const xmlOrder = convert.js2xml(order, {
      compact: true
    })

    /**
     * 返回转换成 xml 格式的数据
     */
    return xmlOrder
  }

  /**
   * xml 数据转换为 object。
   *
   * @param  {Object} xmlData 要转换的数据。
   * @return {Object} 返回转换之后的数据。
   */
  xmlToJS (xmlData) {
    /**
     * 转换 xml 数据。
     */
    const _data = convert.xml2js(xmlData, {
      compact: true,
      cdataKey: 'value',
      textKey: 'value'
    }).xml

    /** 去掉数据中的 value 属性 */
    const data = Object.keys(_data).reduce((accumulator, key) => {
      accumulator[key] = _data[key].value
      return accumulator
    }, {})

    /**
     * 返回转换之后的结果。
     */
    return data
  }

  /**
   * 支付。
   *
   * @param  {Object}  request 请求对象，用作读取请求头部数据。
   * @param  {Object}  session 会话，把订单号放到会员中。
   * @return {string} 返回支付跳转链接。
   */
  async pay ({ request, session }) {
    logger.info('请求支付 ------------------------')

    /**
     * 登录凭证，
     * 从小程序那里调用 wx.login 得到并发送到这里。
     */
    // const code = request.input('code')
    // const appid = '1111874689'
    // const nonce_str = randomString.generate(32)
    const token = await axios.get(`https://api.q.qq.com/api/getToken?grant_type=client_credential&appid=1111874689&secret=ELCbJdOZF87epPxe`)

    /** 公众账号 ID */
    const appid = 'wxcd2bfbbc93382620'

    /** 商户号 */
    const mch_id = '1544401641'

    /** 密钥 */
    const key = 'ELCbJdOZF87epPxe'

    /** 商户订单号 */
    const out_trade_no = moment().local().format('YYYYMMDDHHmmss')

    /** 商品描述 */
    const body = 'test'

    /** 商品价格 */
    const total_fee = 1

    /** 支付类型 */
    const trade_type = 'MWEB'

    /** 用户 IP */
    const spbill_create_ip = request.ip()

    /** 商品 ID */
    const product_id = 1

    /** 通知地址 */
    const notify_url = 'http://127.0.0.1:3333/checkout/payNotify'

    /** 随机字符 */
    const nonce_str = randomString.generate(32)

    /**
     * 准备支付数据。
     */
    let order = {
      appid,
      mch_id,
      out_trade_no,
      body,
      total_fee,
      trade_type,
      product_id,
      notify_url,
      nonce_str,
      spbill_create_ip
    }
    const sign = this.paySign(order, 'Q12345678910111213141516171819ee')
    const xmlOrder = this.orderToXML(order, sign)

    /**
     * 调用支付统一下单接口。
     */
    // const wxPayResponse = await axios.post('https://qpay.qq.com/cgi-bin/pay/qpay_unified_order.cgi', xmlOrder)
    const wxPayResponse = await axios.post(`https://api.q.qq.com/wxpay/unifiedorder?appid=1111874689&access_token=${ token.data.access_token }&real_notify_url=${ encodeURI('http://127.0.0.1:3333/checkout/payNotify') }`, xmlOrder)
    console.log(wxPayResponse.data);


    const data = this.xmlToJS(wxPayResponse.data)
    console.log('下单接口：\n', data);
    // logger.info('下单接口：\n', data)

    /**
     * JSAPI 参数
     */
    const timeStamp = moment().local().unix()
    const prepay_id = data.prepay_id

    let wxJSApiParams = {
      appid,
      timeStamp: `${ timeStamp }`,
      nonceStr: nonce_str,
      package: `prepay_id=${ prepay_id }`,
      signType: 'MD5'
    }

    const paySign = this.paySign(wxJSApiParams, 'Q12345678910111213141516171819ee')

    wxJSApiParams = {
      ...wxJSApiParams,
      paySign
    }

    /**
     * 为前端返回 JSAPI 参数，
     * 根据这些参数，调用支付功能。
     */
    logger.info('JSAPI 参数：\n', wxJSApiParams)
    return wxJSApiParams
  }

  /**
   * 处理支付结果通知，
   * 支付成功以后，会发送支付结果给我们。
   *
   * @param  {Object} request 获取到支付结果通知里的数据。
   * @return 响应支付系统，验证的结果。
   */
  async payNotify ({ request }) {
    logger.warn('处理支付结果通知 ------------------------')

    /**
     * 获取并处理通知里的支付结果，
     * 结果数据是 xml 格式，所以需要把它转换成 object。
     */
    const _payment = convert.xml2js(request._raw, {
      compact: true,
      cdataKey: 'value',
      textKey: 'value'
    }).xml

    const payment = Object.keys(_payment).reduce((accumulator, key) => {
      accumulator[key] = _payment[key].value
      return accumulator
    }, {})

    logger.info('支付结果：\n', payment)

    /**
     * 验证支付结果，
     * 可以验证支付金额与签名，
     * 这里我只验证了签名。
     */
    const paymentSign = payment.sign
    logger.info('结果签名：', paymentSign)

    delete payment['sign']
    const key = '1234567890Qwertyuiopasdfghjklzxc'
    const selfSign = this.paySign(payment, key)
    logger.info('自制签名：', selfSign)

    /**
     * 构建回复数据，
     * 验证之后，要把验证的结果告诉支付系统。
     */
    const return_code = paymentSign === selfSign ? 'SUCCESS' : 'FAIL'
    logger.debug('回复代码：', return_code)

    const reply = {
      xml: {
        return_code
      }
    }

    /**
     * 响应支付系统，验证的结果。
     */
    return convert.js2xml(reply, {
      compact: true
    })
  }
}

module.exports = QQCheckoutController
