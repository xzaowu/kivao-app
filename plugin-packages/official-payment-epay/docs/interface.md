## yingce.payment/v1

### RPC 业务错误

插件仅按真实错误类型写出 `order_not_found`、`order_not_paid`、`trade_bill_not_found`，宿主恢复对应类型，不根据错误文字关单。易支付未提供统一账单接口时保留“账单不存在”含义；网关返回通用查单错误时继续作为未知状态处理，不把“订单不存在或查询失败”提示自动当作明确不存在。网络异常、验签失败和损坏响应均不能作为关单或入账凭据。此修复需宿主与插件执行文件配套更新，原多支付方式配置及请求字段保持不变。

### 多支付方式（1.0.10）

`payTypes` 为以英文逗号分隔的开放方式，例如 `alipay,wxpay`；后台提供多选，支持清单声明的支付宝、微信、QQ 和 USDT，实际能力取决于网关。`payType` 仍是默认方式，必须在开放列表中。旧配置没有 `payTypes` 时只开放原默认方式，不自动开放其他通道。

宿主将用户选中的 `paymentMethod` 固定到订单，并在插件 `create_order` 请求中传入；插件校验开放列表后将该单值写入上游 `type` 并参与原有 MD5/RSA 签名。不能把整个列表拼成 `type`。收银台刷新使用订单选择与原配置版本；幂等键不能用于不同的支付方式。插件仍使用 `yingce.payment/v1`，新增请求字段可选，旧订单缺少字段时使用其历史配置默认方式。宿主需配套支持订单字段及插件清单 `paymentMethods`，不能仅替换前端或清单而保留旧执行文件。

支持 `validate_config`、`create_order`、`query_order`、`close_order`、`verify_notification` 和 `download_trade_bill`，统一返回 JSON 响应。

易支付渠道协议全部封装在本插件内：V1 下单 `POST /mapi.php`（MD5），查单 `GET /api.php?act=order`；V2 下单 `POST /api/pay/create`（RSA，`method=jump`），异步通知为 form/JSON，成功应答 `success`。配置字段包括 `publicBaseUrl`、`pid`、`key`、`gateway`、`payType`、`version`、`checkoutMode`、`privateKey`、`platformPublicKey`。

必须显式填写可信 `gateway`，不默认向任何第三方网关发送商户信息。V1 查单严格校验商户（响应包含时）、订单号、正数金额、支付状态和成功流水号；不以请求中的订单号或零金额掩盖不完整响应。通知校验拒绝重复参数、无效签名、非正金额及缺失的成功流水号。支付地址只接受 HTTP(S) 与明确允许的微信、支付宝、QQ 支付协议，不接受任意本机协议或含用户名密码的地址。

V1 关单先查单：已支付订单返回付款凭据，未付款订单只关闭宿主本地记录，不能据此声称上游支付链接已失效。V2 当前仅实现下单和通知验签，未实现查单、刷新收银台和安全关单；`query_order` 返回 `epay_query_unsupported`，`close_order` 返回 `epay_close_unsupported`，不会把未知订单标成已关闭。启用 V2 前需接受这一限制并准备在网关人工核对订单；本次没有新增或猜测 V2 查单接口。交易账单下载返回 not found，不表示已完成对账。

<!-- YINGCE_MANIFEST_CONTRACT_START -->
## Manifest 完整接口定义

以下 JSON 与插件包内实际 `manifest.json` 逐字段一致，覆盖插件身份、权限、配置、鉴权、参数、校验、创建、Agent、查询、取消、结果下载、响应和 Agent 响应映射。`documentation` 字段的值就是当前完整文档；为避免文档在自身内部无限递归，JSON 中仅用等义占位文本表示正文。

```json
{
  "apiVersion": "yingce.plugin/v1",
  "id": "official-payment-epay",
  "name": "易支付",
  "version": "1.0.10",
  "author": "Epay",
  "description": "易支付适配器，支持 V1/MD5 与 V2/RSA 的支付宝/微信/QQ 通道。",
  "enabled": true,
  "installable": true,
  "runtime": {
    "backend": "rpc",
    "backendEntry": "backend/provider"
  },
  "surfaces": [
    "wallet",
    "settings"
  ],
  "permissions": [
    "payment.create",
    "payment.query",
    "payment.close",
    "payment.reconcile"
  ],
  "configuration": {
    "fields": [
      {
        "name": "publicBaseUrl",
        "type": "url",
        "label": "服务器公网地址",
        "required": true,
        "description": "用于确认回调可达；实际 notify_url 由宿主订单生成。"
      },
      {
        "name": "pid",
        "type": "string",
        "label": "商户号 (pid)",
        "required": true
      },
      {
        "name": "key",
        "type": "password",
        "label": "商户密钥 (key)",
        "required": false,
        "secret": true,
        "description": "V1/MD5 密钥；version=1 可留空。"
      },
      {
        "name": "gateway",
        "type": "url",
        "label": "支付网关",
        "required": true,
        "description": "显式填写可信易支付网关根地址，不要带 /mapi.php；不会默认向第三方网关发送商户信息。"
      },
      {
        "name": "payTypes",
        "type": "multiselect",
        "label": "开放的支付方式",
        "required": true,
        "default": "alipay",
        "values": [
          "alipay",
          "wxpay",
          "qqpay",
          "usdt"
        ],
        "description": "可同时开放多种，由用户下单时选择。只勾选该商户网关实际已开通的方式；原有配置未填写时沿用默认方式。"
      },
      {
        "name": "payType",
        "type": "string",
        "label": "默认支付方式",
        "required": false,
        "default": "alipay",
        "values": [
          "alipay",
          "wxpay",
          "qqpay",
          "usdt"
        ],
        "description": "未指定支付方式时使用，必须包含在开放的支付方式中。"
      },
      {
        "name": "version",
        "type": "string",
        "label": "接口版本",
        "required": false,
        "default": "0",
        "values": [
          "0",
          "1"
        ],
        "description": "0=V1/MD5，1=V2/RSA。V2 仅支持下单和验签通知，暂不支持查单、刷新收银台及自动关单，启用前需确认此限制。"
      },
      {
        "name": "checkoutMode",
        "type": "string",
        "label": "收银方式",
        "required": false,
        "default": "redirect",
        "values": [
          "redirect",
          "qr_code"
        ],
        "description": "redirect 跳转；qr_code 展示二维码载荷。"
      },
      {
        "name": "privateKey",
        "type": "textarea",
        "label": "V2 商户私钥",
        "required": false,
        "secret": true,
        "description": "仅 version=1，PEM 或裸 Base64。"
      },
      {
        "name": "platformPublicKey",
        "type": "textarea",
        "label": "V2 平台公钥",
        "required": false,
        "description": "仅 version=1，PEM 或裸 Base64。"
      }
    ]
  },
  "contributes": {
    "paymentProviders": [
      {
        "id": "epay",
        "label": "易支付",
        "icon": "assets/icon.svg",
        "checkoutMode": "redirect",
        "identityFields": [
          "pid"
        ],
        "expiryPolicy": {
          "defaultMinutes": 10,
          "minMinutes": 5,
          "maxMinutes": 1440
        },
        "notificationSuccess": {
          "status": 200,
          "contentType": "text/plain; charset=utf-8",
          "body": "success"
        },
        "notificationFailure": {
          "status": 400,
          "contentType": "text/plain; charset=utf-8",
          "body": "failure"
        },
        "paymentMethods": [
          {
            "id": "alipay",
            "label": "支付宝"
          },
          {
            "id": "wxpay",
            "label": "微信支付"
          },
          {
            "id": "qqpay",
            "label": "QQ 钱包"
          },
          {
            "id": "usdt",
            "label": "USDT"
          }
        ]
      }
    ]
  },
  "documentation": "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
}
```
<!-- YINGCE_MANIFEST_CONTRACT_END -->
