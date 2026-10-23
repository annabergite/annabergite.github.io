$(document).ready(function() {
    var headingCount1 = $("h1").length;
    var headingCount2 = $("h2").length;
    var headingCount3 = $("h3").length;
    var headingCount4 = $("h4").length;
    var headingCount5 = $("h5").length;
    var headingCount6 = $("h6").length;
    var headingCount7 = $("h7").length;
    var tocHeading = "";

    if (headingCount1 > 1) {
      if(tocHeading == "") {
        tocHeading = "h1";
      } else {
        tocHeading += ",h1"
      }
    }

    if (headingCount2 > 1) {
        if(tocHeading == "") {
          tocHeading = "h2";
        } else {
          tocHeading += ",h2"
        }
    }

    if (headingCount3 > 1) {
        if(tocHeading == "") {
          tocHeading = "h3";
        } else {
          tocHeading += ",h3"
        }
    }

    if (headingCount4 > 1) {
        if(tocHeading == "") {
          tocHeading = "h4";
        } else {
          tocHeading += ",h4"
        }
    }
    if (headingCount5 > 1) {
        if(tocHeading == "") {
          tocHeading = "h5";
        } else {
          tocHeading += ",h5"
        }
    }

    if (headingCount6 > 1) {
        if(tocHeading == "") {
          tocHeading = "h6";
        } else {
          tocHeading += ",h6"
        }
    }

    $("#toc").tocify({
        selectors: tocHeading
      });

    // 目录标题过长时通过 CSS 省略号截断；这里为每个目录链接补充完整标题，
    // 鼠标悬停时浏览器会弹出 title 小提示展示全名，复制时取到的仍是完整文本。
    $("#toc a").each(function() {
      var fullText = $(this).text();
      if (fullText) {
        this.title = fullText;
      }
    });
  });