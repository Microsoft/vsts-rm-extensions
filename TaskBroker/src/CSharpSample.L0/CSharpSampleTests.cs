// --------------------------------------------------------------------------------------------------------------------
// <copyright file="CSharpSampleTests.cs" company="Microsoft">
// </copyright>
// <summary>
//   Defines the CSharpSampleTests type.
// </summary>
// --------------------------------------------------------------------------------------------------------------------

namespace CSharpSampleTests
{
    using System;
    using CSharpSample;
    using FluentAssertions;
    using Microsoft.VisualStudio.TestTools.UnitTesting;

    [TestClass]
    public class CSharpSampleTests
    {
        [TestMethod]
        public void TestHello()
        {
            CSharpSample.Hello().Should().Be("Hello, World!");
        }
    }
}
