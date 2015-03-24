var map = function(){
  
  this.token = '83e4424df5a9e9fc8c6ee4f2bdebf351' ; // rogiervanstraten.github.io

  this.initialize = function(){

    var width = 960, height = 700 ;

    var svg = d3.select(".map")
                .append("svg")
                .attr("width", width)
                .attr("height", height);


    var projection = d3.geo.mercator();
    var path = d3.geo.path().projection( projection );

    var self = this ;
    var communeSVG = svg.append("g") ;

    d3.json('http://thebarn.from89.com/api/geom/province?key=' + this.token, function( error, json ) {

      if( error || ! json ) return false ;

      var provinceSVG = svg.append("g") ;

      // Set the center
      // MIND THE CLOCKWISE CENTROID CALC
      var center = d3.geo.centroid( json ) ;
      var scale = 100 ;

      var bounds  = d3.geo.bounds(json);

      // scale to bounds
      var hscale  = scale * width  / (bounds[1][0] - bounds[0][0]);
      var vscale  = scale * height / (bounds[1][1] - bounds[0][1]);
      var scale   = (hscale > vscale) ? hscale : vscale;

      // center align
      var offset  = [width - (bounds[0][0] + bounds[1][0])/2, height - (bounds[0][1] + bounds[1][1])/2];

      // Adjust projection based on data.
      projection.center(center).scale(scale).translate(offset);


      // For each polygon add path
      provinceSVG
        .attr("class", "province")
        .selectAll("path")
        .data( json.features ).enter()
        .append("path")
        .attr("d", path ).attr('class', 'animated short fadeIn');


      d3.json('http://thebarn.from89.com/api/geom/commune?key=' + self.token, function( error, commune ) {

        // For each polygon add path
        communeSVG.attr("class", "commune")
          .selectAll("path")
          .data( commune.features ).enter()
          .append("path")
          .attr("d", path ).attr('class', 'animated fadeIn');

      });

    });


  }

  this.project = function(){}

  this.initialize() ;

} ;

var slideshow = function( el, delay, fadeTime ){

  this.el = $( el ) ;
  this.delay = delay || 5000 ;
  this.fadeTime = fadeTime || false ;
  
  var root = this ;

  var next, prev ;

  var initialize = function(){

    var slides = $( el ).find('.slide') ;

    if( fadeTime ) {

      slides.css('transition', 'opacity ease ' + fadeTime / 1000 + 's' ) ;

    }

    root.initSlideshow( slides ) ;

  }

  this.initSlideshow = function( slides ){

    var e = this.el,        //element
        s = 0,              // iteration
        c = slides.length ; // length

    slides.each(function(){

      var el=$( this ),
          src = el.attr( 'data-src' ) ;

      el.css( 'background-image', 'url(' + src + ')' ) ;

    });

    prev = $( slides[s] ) ;
    prev.css({ opacity: 1 }) ;
      
    next = s + 1;

    if( c === 1 ) return ;

    var s = setInterval(function(){

      prev.css({ opacity: 0 }) ;

      // set new prev
      prev = $( slides[next] ) ;
      prev.css({ opacity: 1 }) ;
      
      next = ( ( next + 1 ) === c ) ? 0 : next + 1 ;
        
    }, this.delay + this.fadeTime );

  }

  initialize( el, delay ) ;

} ;


function webpages(){

  var totalWidth = 0 ;

  $('.webpage-list li').each(function(){

    totalWidth = totalWidth + $( this ).outerWidth() + 1 ;

  });

  $('.webpage-list').css({ width : totalWidth + 'px' }) ;

  $('.webpages').mousemove(_.throttle( function( event ) {

    var w = $(window).width() ;

    var ratio = - ( totalWidth - w ) / w ;

    $('.webpage-list').css({ 'transform': 'translateX(' + ( ratio * event.pageX ) + 'px )'}) ; 

  }, 100, true ) );

}

$(document).ready(function(){

  var Map = new map() ;
  
  var slides = [] ;

  $('.autoslide').each(function(){

    slides.push( new slideshow( this, 4000, 300 ) ) ;

  }) ;

  webpages() ;

});